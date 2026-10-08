import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { scope } from "../../middleware/storeScope";

const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(), // sent from client for display, but re-validated against DB price server-side
  discount: z.number().nonnegative().default(0),
});

const createSaleSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  customerId: z.string().uuid().optional(),
  discount: z.number().nonnegative().default(0), // invoice-level discount
  applyTax: z.boolean().default(true),
  paymentMethodId: z.string().uuid(),
  attachmentUrl: z.string().url().optional(), // bank-transfer receipt photo, already uploaded via /api/store/files
  allowNegativeStock: z.boolean().optional(), // only honored if the store setting permits it — see below
  installment: z.object({
    customerId: z.string().uuid(),
    downPayment: z.number().nonnegative().default(0),
    months: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(12)]),
    profitPercent: z.number().nonnegative().max(1000).default(0),
    notes: z.string().optional(),
  }).optional(),
});

type CreateSaleInput = z.infer<typeof createSaleSchema>;
type AuthCtx = { tenantId: string; storeId: string; userId: string };

async function expandVirtualBundle(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: Prisma.Decimal,
  tenantId: string,
  storeId: string,
  visited = new Set<string>(),
): Promise<Map<string, Prisma.Decimal>> {
  const product = await tx.product.findFirst({ where: { id: productId, tenantId, storeId, isActive: true } });
  if (!product) throw Object.assign(new Error("One or more products not found"), { status: 400 });

  // Composite products are sold from their components. The composite row
  // itself does not need stock, regardless of the legacy bundle type value.
  const isComposite = product.productType === "COMPOSITE";
  if (!isComposite) return new Map([[product.id, quantity]]);
  if (visited.has(product.id)) throw Object.assign(new Error("Circular bundle reference is not allowed"), { status: 400 });
  visited.add(product.id);

  const bom = await tx.bomVersion.findFirst({
    where: { productId: product.id, tenantId, storeId, status: "active" },
    include: { items: true },
    orderBy: { version: "desc" },
  });
  if (!bom || bom.items.length === 0) throw Object.assign(new Error(`No active BOM found for ${product.name}`), { status: 400 });

  const expanded = new Map<string, Prisma.Decimal>();
  for (const item of bom.items) {
    const childItems = await expandVirtualBundle(tx, item.componentProductId, quantity.mul(item.quantity), tenantId, storeId, new Set(visited));
    for (const [childId, childQuantity] of childItems) {
      expanded.set(childId, (expanded.get(childId) ?? new Prisma.Decimal(0)).add(childQuantity));
    }
  }
  return expanded;
}

/**
 * Core sale-creation logic, usable from the direct HTTP handler AND from
 * the offline sync processor (spec section 27) — both need identical
 * re-pricing, stock-locking, and invoice-numbering behavior.
 */
export async function performCreateSale(auth: AuthCtx, data: CreateSaleInput) {
  const { tenantId, storeId, userId } = auth;
  const { items, customerId, discount, applyTax, paymentMethodId, attachmentUrl, installment } = data;
  const cashSession = await prisma.cashSession.findFirst({ where: { tenantId, storeId, status: "open" } });
  if (!cashSession) throw Object.assign(new Error("Open the cash register before creating a sale"), { status: 409 });
  if (installment && customerId !== installment.customerId) throw Object.assign(new Error("Installment customer must match the invoice customer"), { status: 400 });

  const paymentMethod = await prisma.paymentMethod.findFirst({ where: { id: paymentMethodId, tenantId, storeId } });
  if (!paymentMethod) throw Object.assign(new Error("Invalid payment method"), { status: 400 });
  if (paymentMethod.requiresAttachment && !attachmentUrl) {
    throw Object.assign(new Error("This payment method requires a transfer receipt attachment"), { status: 400 });
  }

  const allowNegativeSetting = await prisma.setting.findFirst({ where: { tenantId, storeId, key: "allow_negative_stock" } });
  const allowNegative = allowNegativeSetting?.value === true || data.allowNegativeStock;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const products = await tx.product.findMany({
          where: { id: { in: items.map((i) => i.productId) }, tenantId, storeId, isActive: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        if (byId.size !== items.length) throw Object.assign(new Error("One or more products not found"), { status: 400 });

        let subtotal = new Prisma.Decimal(0);
        const lineData: { productId: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; discount: Prisma.Decimal; total: Prisma.Decimal }[] = [];
        const stockRequirements = new Map<string, Prisma.Decimal>();

        for (const item of items) {
          const product = byId.get(item.productId)!;
          const qty = new Prisma.Decimal(item.quantity);
          const lineDiscount = new Prisma.Decimal(item.discount);
          const unitPrice = product.salePrice; // server-side price of record, never the client's
          const lineTotal = unitPrice.mul(qty).sub(lineDiscount);
          subtotal = subtotal.add(lineTotal);
          lineData.push({ productId: product.id, quantity: qty, unitPrice, discount: lineDiscount, total: lineTotal });

          const expanded = await expandVirtualBundle(tx, product.id, qty, tenantId, storeId);
          for (const [stockProductId, requiredQuantity] of expanded) {
            stockRequirements.set(stockProductId, (stockRequirements.get(stockProductId) ?? new Prisma.Decimal(0)).add(requiredQuantity));
          }
        }

        for (const [stockProductId, requiredQuantity] of stockRequirements) {
          const stockProduct = await tx.product.findFirst({ where: { id: stockProductId, tenantId, storeId, isActive: true } });
          if (!stockProduct) throw Object.assign(new Error("One or more stock components not found"), { status: 400 });
          const newStock = stockProduct.currentStock.sub(requiredQuantity);
          if (newStock.lt(0) && !allowNegative) {
            throw Object.assign(new Error(`Insufficient stock for ${stockProduct.name}`), { status: 409 });
          }

          await tx.product.update({ where: { id: stockProduct.id }, data: { currentStock: newStock } });
          await tx.inventoryMovement.create({
            data: {
              tenantId, storeId, productId: stockProduct.id, movementType: "sale",
              quantity: requiredQuantity.neg(), qtyBefore: stockProduct.currentStock, qtyAfter: newStock,
              createdBy: userId,
            },
          });
        }

        const invoiceDiscount = new Prisma.Decimal(discount);
        const taxableAmount = subtotal.sub(invoiceDiscount);
        const activeTax = applyTax ? await tx.tax.findFirst({ where: { tenantId, storeId, isEnabled: true } }) : null;
        const taxAmount = activeTax ? taxableAmount.mul(activeTax.rate).div(100) : new Prisma.Decimal(0);
        const total = taxableAmount.add(taxAmount);
        if (installment) {
          const customer = await tx.customer.findFirst({ where: { id: installment.customerId, tenantId, storeId } });
          if (!customer) throw Object.assign(new Error("Customer not found for installment sale"), { status: 404 });
          const installmentTotal = Number(total) * (1 + installment.profitPercent / 100);
          if (installment.downPayment > installmentTotal) throw Object.assign(new Error("Down payment cannot exceed the installment total"), { status: 400 });
        }

        const last = await tx.sale.findFirst({ where: { tenantId, storeId }, orderBy: { invoiceNumber: "desc" } });
        const nextInvoiceNumber = (last?.invoiceNumber ?? 0) + 1;

        const sale = await tx.sale.create({
          data: {
            tenantId, storeId, invoiceNumber: nextInvoiceNumber,
            customerId, cashierId: userId,
            subtotal, discount: invoiceDiscount, taxAmount, total,
            paymentMethodId, status: "completed", attachmentUrl,
            items: { create: lineData },
          },
          include: { items: true },
        });
        if (installment) {
          const installmentTotal = total.mul(new Prisma.Decimal(1 + installment.profitPercent / 100));
          const remainingAmount = installmentTotal.sub(installment.downPayment);
          const monthlyAmount = remainingAmount.div(installment.months).toDecimalPlaces(2);
          const plan = await tx.customerInstallmentPlan.create({
            data: {
              tenantId, storeId, customerId: installment.customerId, saleId: sale.id,
              totalAmount: installmentTotal, profitPercent: installment.profitPercent, downPayment: installment.downPayment, remainingAmount,
              installmentMonths: installment.months, notes: installment.notes, createdBy: userId,
            },
          });
          if (installment.downPayment > 0) {
            await tx.payment.create({
              data: { tenantId, storeId, partyType: "customer", partyId: installment.customerId, amount: installment.downPayment, paymentMethodId, createdBy: userId },
            });
          }
          if (remainingAmount.gt(0)) {
            await tx.customer.update({ where: { id: installment.customerId }, data: { balance: { increment: remainingAmount } } });
          }
          let allocated = new Prisma.Decimal(0);
          await tx.customerInstallment.createMany({
            data: Array.from({ length: installment.months }, (_, index) => {
              const amount = index === installment.months - 1 ? remainingAmount.sub(allocated) : monthlyAmount;
              allocated = allocated.add(amount);
              const dueDate = new Date();
              dueDate.setMonth(dueDate.getMonth() + index + 1);
              return { planId: plan.id, installmentNumber: index + 1, dueDate, amount, remainingAmount: amount, status: index === 0 ? "due" : "not_due" };
            }),
          });
        }
        const createdSale = await tx.sale.findUnique({ where: { id: sale.id }, include: { items: true, installmentPlan: { include: { installments: { orderBy: { installmentNumber: "asc" } } } } } });
        if (!createdSale) throw Object.assign(new Error("Sale was not created"), { status: 500 });
        return createdSale;
      });
    } catch (err: any) {
      const isUniqueClash = err?.code === "P2002"; // invoice_number race — retry with a fresh number
      if (isUniqueClash && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
  throw Object.assign(new Error("Failed to allocate an invoice number after retries"), { status: 500 });
}

export async function createSale(req: Request, res: Response) {
  const parsed = createSaleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  try {
    const sale = await performCreateSale({ tenantId, storeId, userId: req.auth!.userId }, parsed.data);
    await logAudit(req, { action: "sale.created", entity: "Sale", entityId: sale.id, after: { invoiceNumber: sale.invoiceNumber, total: sale.total } });
    return res.status(201).json(sale);
  } catch (err: any) {
    return res.status(err?.status || 500).json({ error: err?.message || "Failed to create sale" });
  }
}

export async function listSales(req: Request, res: Response) {
  const { status } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Number(req.query.pageSize) || 30);
  const where: any = { ...scope(req) };
  if (typeof status === "string") where.status = status;

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { invoiceNumber: "desc" }, include: { items: true } }),
    prisma.sale.count({ where }),
  ]);
  res.json({ data: sales, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

export async function getSale(req: Request, res: Response) {
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, ...scope(req) }, include: { items: true } });
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  const returns = await prisma.saleReturn.findMany({ where: { saleId: sale.id, ...scope(req) }, orderBy: { createdAt: "desc" } });
  const returnItems = returns.length
    ? await prisma.saleReturnItem.findMany({ where: { saleReturnId: { in: returns.map((entry) => entry.id) } } })
    : [];
  const products = await prisma.product.findMany({ where: { id: { in: sale.items.map((item) => item.productId) }, ...scope(req) }, select: { id: true, purchasePrice: true } });
  const costByProductId = new Map(products.map((product) => [product.id, product.purchasePrice]));
  const returnedRevenue = returns.reduce((sum, entry) => sum.add(entry.total), new Prisma.Decimal(0));
  const totalCost = sale.items.reduce((sum, item) => sum.add((costByProductId.get(item.productId) ?? new Prisma.Decimal(0)).mul(item.quantity)), new Prisma.Decimal(0));
  const returnedCost = returnItems.reduce((sum, item) => {
    const saleItem = sale.items.find((line) => line.id === item.saleItemId);
    return sum.add((saleItem ? costByProductId.get(saleItem.productId) ?? new Prisma.Decimal(0) : new Prisma.Decimal(0)).mul(item.quantity));
  }, new Prisma.Decimal(0));
  const netTotal = sale.total.sub(returnedRevenue);
  const netProfit = netTotal.sub(totalCost.sub(returnedCost));
  res.json({
    ...sale,
    financials: { netTotal, totalCost: totalCost.sub(returnedCost), netProfit },
    returns: returns.map((entry) => ({
      ...entry,
      items: returnItems.filter((item) => item.saleReturnId === entry.id),
    })),
  });
}

const cancelSchema = z.object({ reason: z.string().min(1) });

/** Never deletes the row — flips status to cancelled and reverses stock (spec section 7). */
export async function cancelSale(req: Request, res: Response) {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Cancellation reason is required" });

  const { tenantId, storeId } = scope(req);
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, tenantId, storeId }, include: { items: true } });
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  if (sale.status !== "completed") return res.status(409).json({ error: `Sale is already ${sale.status}` });

  await prisma.$transaction(async (tx) => {
    for (const item of sale.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) continue;
      const newStock = product.currentStock.add(item.quantity);
      await tx.product.update({ where: { id: product.id }, data: { currentStock: newStock } });
      await tx.inventoryMovement.create({
        data: {
          tenantId, storeId, productId: product.id, movementType: "sale_return",
          quantity: item.quantity, qtyBefore: product.currentStock, qtyAfter: newStock,
          referenceId: sale.id, createdBy: req.auth!.userId,
        },
      });
    }
    await tx.sale.update({ where: { id: sale.id }, data: { status: "cancelled", cancelReason: parsed.data.reason } });
  });

  await logAudit(req, { action: "sale.cancelled", entity: "Sale", entityId: sale.id, before: { status: sale.status }, after: { status: "cancelled", reason: parsed.data.reason } });
  res.json({ id: sale.id, status: "cancelled" });
}

const returnSchema = z.object({
  items: z.array(z.object({ saleItemId: z.string().uuid(), quantity: z.number().positive() })).min(1),
});

/** Partial or full return (spec section 8) — restocks, records a SaleReturn, and flips the parent sale's status. */
export async function returnSale(req: Request, res: Response) {
  const parsed = returnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, tenantId, storeId }, include: { items: true } });
  if (!sale) return res.status(404).json({ error: "Sale not found" });
  if (sale.status === "cancelled") return res.status(409).json({ error: "Cannot return a cancelled sale" });

  const saleItemById = new Map(sale.items.map((i) => [i.id, i]));

  const result = await prisma.$transaction(async (tx) => {
    let returnTotal = new Prisma.Decimal(0);
    const saleReturn = await tx.saleReturn.create({ data: { saleId: sale.id, tenantId, storeId, createdBy: req.auth!.userId, total: 0 } });

    for (const line of parsed.data.items) {
      const saleItem = saleItemById.get(line.saleItemId);
      if (!saleItem) throw Object.assign(new Error("Sale item not found on this invoice"), { status: 400 });

      // Sum what's already been returned for this line to prevent over-returning.
      const alreadyReturned = await tx.saleReturnItem.aggregate({
        where: { saleItemId: saleItem.id },
        _sum: { quantity: true },
      });
      const returnedSoFar = alreadyReturned._sum.quantity ?? new Prisma.Decimal(0);
      const returnQty = new Prisma.Decimal(line.quantity);
      if (returnedSoFar.add(returnQty).gt(saleItem.quantity)) {
        throw Object.assign(new Error("Cannot return more than was sold"), { status: 409 });
      }

      const lineTotal = saleItem.unitPrice.mul(returnQty);
      returnTotal = returnTotal.add(lineTotal);

      await tx.saleReturnItem.create({ data: { saleReturnId: saleReturn.id, saleItemId: saleItem.id, quantity: returnQty, total: lineTotal } });

      const product = await tx.product.findUnique({ where: { id: saleItem.productId } });
      if (product) {
        const newStock = product.currentStock.add(returnQty);
        await tx.product.update({ where: { id: product.id }, data: { currentStock: newStock } });
        await tx.inventoryMovement.create({
          data: {
            tenantId, storeId, productId: product.id, movementType: "sale_return",
            quantity: returnQty, qtyBefore: product.currentStock, qtyAfter: newStock,
            referenceId: sale.id, createdBy: req.auth!.userId,
          },
        });
      }
    }

    await tx.saleReturn.update({ where: { id: saleReturn.id }, data: { total: returnTotal } });

    // Was everything on the invoice returned? Mark fully returned, else partial.
    const priorReturns = await tx.saleReturn.findMany({ where: { saleId: sale.id }, select: { id: true } });
    const allReturned = await tx.saleReturnItem.groupBy({
      by: ["saleItemId"],
      _sum: { quantity: true },
      where: { saleReturnId: { in: priorReturns.map((r) => r.id) } },
    });
    const fullyReturned = sale.items.every((item) => {
      const returned = allReturned.find((r) => r.saleItemId === item.id)?._sum.quantity ?? new Prisma.Decimal(0);
      return returned.gte(item.quantity);
    });
    await tx.sale.update({ where: { id: sale.id }, data: { status: fullyReturned ? "returned" : "partially_returned" } });

    return saleReturn;
  });

  await logAudit(req, { action: "sale.returned", entity: "SaleReturn", entityId: result.id, after: { saleId: sale.id, total: result.total } });
  res.status(201).json(result);
}

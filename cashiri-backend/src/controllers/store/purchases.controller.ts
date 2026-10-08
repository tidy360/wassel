import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { scope } from "../../middleware/storeScope";
import { createProposalIfNeeded } from "../../lib/pricing";

const purchaseItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative().optional(),
});

const createPurchaseSchema = z.object({
  supplierId: z.string().uuid().optional(),
  items: z.array(purchaseItemSchema).min(1),
  discount: z.number().nonnegative().default(0),
  taxAmount: z.number().nonnegative().default(0),
  paidAmount: z.number().nonnegative().default(0),
  paymentMethodId: z.string().uuid().optional(),
});

/** Creating (= approving) a purchase increases stock immediately (spec section 11). */
export async function createPurchase(req: Request, res: Response) {
  const parsed = createPurchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  const { supplierId, items, discount, taxAmount, paidAmount, paymentMethodId } = parsed.data;

  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) }, tenantId, storeId } });
  const byId = new Map(products.map((p) => [p.id, p]));
  if (byId.size !== items.length) return res.status(400).json({ error: "One or more products not found" });

  let subtotal = new Prisma.Decimal(0);
  const lineData = items.map((item) => {
    const total = new Prisma.Decimal(item.unitPrice).mul(item.quantity);
    subtotal = subtotal.add(total);
    return { productId: item.productId, quantity: new Prisma.Decimal(item.quantity), unitPrice: new Prisma.Decimal(item.unitPrice), salePrice: item.salePrice === undefined ? undefined : new Prisma.Decimal(item.salePrice), total };
  });
  const total = subtotal.sub(discount).add(taxAmount);

  const purchase = await prisma.$transaction(async (tx) => {
    const created = await tx.purchase.create({
      data: {
        tenantId, storeId, supplierId, subtotal, discount, taxAmount, total, paidAmount, paymentMethodId,
        createdBy: req.auth!.userId,
        items: { create: lineData.map(({ salePrice: _salePrice, ...item }) => item) },
      },
      include: { items: true },
    });

    for (const item of lineData) {
      const product = byId.get(item.productId)!;
      const newStock = product.currentStock.add(item.quantity);
      await tx.product.update({ where: { id: product.id }, data: { currentStock: newStock, purchasePrice: item.unitPrice, ...(supplierId ? { supplierId } : {}), ...(item.salePrice === undefined ? {} : { salePrice: item.salePrice }) } });
      await tx.inventoryMovement.create({
        data: {
          tenantId, storeId, productId: product.id, movementType: "purchase",
          quantity: item.quantity, qtyBefore: product.currentStock, qtyAfter: newStock,
          referenceId: created.id, createdBy: req.auth!.userId,
        },
      });
    }

    if (supplierId && paidAmount.toString() !== total.toString()) {
      const remaining = total.sub(paidAmount);
      await tx.supplier.update({ where: { id: supplierId }, data: { balance: { increment: remaining } } });
    }

    return created;
  });

  await logAudit(req, { action: "purchase.created", entity: "Purchase", entityId: purchase.id, after: { total: purchase.total } });
  for (const item of lineData) {
    const product = await prisma.product.findFirst({ where: { id: item.productId, tenantId, storeId, isActive: true } });
    if (!product) continue;
    const pricing = await prisma.productPricing.findUnique({ where: { productId: product.id } });
    if (pricing && pricing.pricingMode !== "MANUAL" && item.salePrice === undefined) {
      await createProposalIfNeeded(product, tenantId, storeId, "COST_INCREASE", `تم تحديث التكلفة إلى ${item.unitPrice.toString()}`);
    }
  }
  res.status(201).json(purchase);
}

export async function listPurchases(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Number(req.query.pageSize) || 30);
  const where = scope(req);
  const [purchases, total] = await Promise.all([
    prisma.purchase.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" }, include: { items: true } }),
    prisma.purchase.count({ where }),
  ]);
  res.json({ data: purchases, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

export async function getPurchase(req: Request, res: Response) {
  const purchase = await prisma.purchase.findFirst({ where: { id: req.params.id, ...scope(req) }, include: { items: true } });
  if (!purchase) return res.status(404).json({ error: "Purchase not found" });
  res.json(purchase);
}

const purchaseReturnSchema = z.object({
  items: z.array(z.object({ purchaseItemId: z.string().uuid(), quantity: z.number().positive() })).min(1),
});

/** Returning a purchase to the supplier reverses the stock increase and reduces what we owe them. */
export async function returnPurchase(req: Request, res: Response) {
  const parsed = purchaseReturnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  const purchase = await prisma.purchase.findFirst({ where: { id: req.params.id, tenantId, storeId }, include: { items: true } });
  if (!purchase) return res.status(404).json({ error: "Purchase not found" });

  const itemById = new Map(purchase.items.map((i) => [i.id, i]));

  const result = await prisma.$transaction(async (tx) => {
    let returnTotal = new Prisma.Decimal(0);
    const purchaseReturn = await tx.purchaseReturn.create({ data: { purchaseId: purchase.id, tenantId, storeId, total: 0 } });

    for (const line of parsed.data.items) {
      const purchaseItem = itemById.get(line.purchaseItemId);
      if (!purchaseItem) throw Object.assign(new Error("Purchase item not found on this invoice"), { status: 400 });

      const alreadyReturned = await tx.purchaseReturnItem.aggregate({ where: { purchaseItemId: purchaseItem.id }, _sum: { quantity: true } });
      const returnedSoFar = alreadyReturned._sum.quantity ?? new Prisma.Decimal(0);
      const returnQty = new Prisma.Decimal(line.quantity);
      if (returnedSoFar.add(returnQty).gt(purchaseItem.quantity)) {
        throw Object.assign(new Error("Cannot return more than was purchased"), { status: 409 });
      }

      const lineTotal = purchaseItem.unitPrice.mul(returnQty);
      returnTotal = returnTotal.add(lineTotal);
      await tx.purchaseReturnItem.create({ data: { purchaseReturnId: purchaseReturn.id, purchaseItemId: purchaseItem.id, quantity: returnQty, total: lineTotal } });

      const product = await tx.product.findUnique({ where: { id: purchaseItem.productId } });
      if (product) {
        const newStock = product.currentStock.sub(returnQty);
        await tx.product.update({ where: { id: product.id }, data: { currentStock: newStock } });
        await tx.inventoryMovement.create({
          data: {
            tenantId, storeId, productId: product.id, movementType: "purchase_return",
            quantity: returnQty.neg(), qtyBefore: product.currentStock, qtyAfter: newStock,
            referenceId: purchase.id, createdBy: req.auth!.userId,
          },
        });
      }
    }

    await tx.purchaseReturn.update({ where: { id: purchaseReturn.id }, data: { total: returnTotal } });

    if (purchase.supplierId) {
      await tx.supplier.update({ where: { id: purchase.supplierId }, data: { balance: { decrement: returnTotal } } });
    }

    return purchaseReturn;
  });

  await logAudit(req, { action: "purchase.returned", entity: "PurchaseReturn", entityId: result.id, after: { purchaseId: purchase.id, total: result.total } });
  res.status(201).json(result);
}

// ---------- Inventory ----------

const adjustSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number(), // positive = add, negative = remove
  reason: z.enum(["adjustment", "damaged", "opening_balance", "transfer"]),
});

export async function adjustStock(req: Request, res: Response) {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  const product = await prisma.product.findFirst({ where: { id: parsed.data.productId, tenantId, storeId } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const qty = new Prisma.Decimal(parsed.data.quantity);
  const newStock = product.currentStock.add(qty);

  const [, movement] = await prisma.$transaction([
    prisma.product.update({ where: { id: product.id }, data: { currentStock: newStock } }),
    prisma.inventoryMovement.create({
      data: {
        tenantId, storeId, productId: product.id, movementType: parsed.data.reason,
        quantity: qty, qtyBefore: product.currentStock, qtyAfter: newStock, createdBy: req.auth!.userId,
      },
    }),
  ]);

  await logAudit(req, { action: "inventory.adjusted", entity: "Product", entityId: product.id, after: { movementId: movement.id, quantity: parsed.data.quantity } });
  res.status(201).json(movement);
}

export async function listMovements(req: Request, res: Response) {
  const { productId } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
  const where: any = { ...scope(req) };
  if (typeof productId === "string") where.productId = productId;

  const [movements, total] = await Promise.all([
    prisma.inventoryMovement.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" } }),
    prisma.inventoryMovement.count({ where }),
  ]);
  res.json({ data: movements, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

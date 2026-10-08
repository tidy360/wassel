import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";
import { sendAsExcel } from "../../lib/exportExcel";

function dateRange(req: Request) {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (req.query.to) to.setHours(23, 59, 59, 999);
  return { gte: from, lte: to };
}

export async function salesReport(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const createdAt = dateRange(req);
  const sales = await prisma.sale.findMany({ where: { tenantId, storeId, createdAt, status: { not: "cancelled" } }, include: { items: true } });
  const totals = sales.reduce(
    (acc, s) => ({ subtotal: acc.subtotal.add(s.subtotal), discount: acc.discount.add(s.discount), tax: acc.tax.add(s.taxAmount), total: acc.total.add(s.total) }),
    { subtotal: new Prisma.Decimal(0), discount: new Prisma.Decimal(0), tax: new Prisma.Decimal(0), total: new Prisma.Decimal(0) }
  );

  if (req.query.format === "xlsx") {
    return sendAsExcel(res, "sales-report", sales.map((s) => ({
      "رقم الفاتورة": s.invoiceNumber, "التاريخ": s.createdAt.toISOString().slice(0, 10),
      "الإجمالي الفرعي": s.subtotal.toString(), "الخصم": s.discount.toString(), "الضريبة": s.taxAmount.toString(),
      "الإجمالي": s.total.toString(), "الحالة": s.status,
    })));
  }
  res.json({ invoiceCount: sales.length, ...totals, sales });
}

export async function purchasesReport(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const createdAt = dateRange(req);
  const purchases = await prisma.purchase.findMany({ where: { tenantId, storeId, createdAt }, include: { items: true } });
  const total = purchases.reduce((sum, p) => sum.add(p.total), new Prisma.Decimal(0));

  if (req.query.format === "xlsx") {
    return sendAsExcel(res, "purchases-report", purchases.map((p) => ({
      "التاريخ": p.createdAt.toISOString().slice(0, 10), "الإجمالي الفرعي": p.subtotal.toString(),
      "الخصم": p.discount.toString(), "الضريبة": p.taxAmount.toString(), "الإجمالي": p.total.toString(), "المدفوع": p.paidAmount.toString(),
    })));
  }
  res.json({ purchaseCount: purchases.length, total, purchases });
}

export async function taxDeclarationReport(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const createdAt = dateRange(req);
  const [sales, purchases] = await Promise.all([
    prisma.sale.aggregate({
      where: { tenantId, storeId, createdAt, status: { not: "cancelled" } },
      _sum: { subtotal: true, discount: true, taxAmount: true, total: true },
      _count: { id: true },
    }),
    prisma.purchase.aggregate({
      where: { tenantId, storeId, createdAt },
      _sum: { subtotal: true, discount: true, taxAmount: true, total: true },
      _count: { id: true },
    }),
  ]);

  const outputTax = Number(sales._sum.taxAmount ?? 0);
  const inputTax = Number(purchases._sum.taxAmount ?? 0);
  const result = {
    from: createdAt.gte.toISOString(),
    to: createdAt.lte.toISOString(),
    salesCount: sales._count.id,
    salesSubtotal: Number(sales._sum.subtotal ?? 0),
    salesDiscount: Number(sales._sum.discount ?? 0),
    taxableSales: Number(sales._sum.subtotal ?? 0) - Number(sales._sum.discount ?? 0),
    outputTax,
    purchasesCount: purchases._count.id,
    purchasesSubtotal: Number(purchases._sum.subtotal ?? 0),
    purchasesDiscount: Number(purchases._sum.discount ?? 0),
    inputTax,
    netTaxDue: outputTax - inputTax,
  };

  if (req.query.format === "xlsx") {
    return sendAsExcel(res, "tax-declaration", [
      { "البند": "المبيعات الخاضعة", "القيمة": result.taxableSales, "الضريبة": result.outputTax },
      { "البند": "المشتريات الخاضعة", "القيمة": result.purchasesSubtotal - result.purchasesDiscount, "الضريبة": result.inputTax },
      { "البند": "صافي الضريبة المستحقة", "القيمة": "", "الضريبة": result.netTaxDue },
    ]);
  }

  res.json(result);
}

/** Gross profit = sale price - purchase price (cost at time of sale) across the period. */
export async function profitReport(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const createdAt = dateRange(req);
  const sales = await prisma.sale.findMany({ where: { tenantId, storeId, createdAt, status: { not: "cancelled" } }, include: { items: true } });

  const productIds = [...new Set(sales.flatMap((s) => s.items.map((i) => i.productId)))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const costById = new Map(products.map((p) => [p.id, p.purchasePrice]));

  let revenue = new Prisma.Decimal(0);
  let cost = new Prisma.Decimal(0);
  for (const sale of sales) {
    for (const item of sale.items) {
      revenue = revenue.add(item.total);
      cost = cost.add((costById.get(item.productId) ?? new Prisma.Decimal(0)).mul(item.quantity));
    }
  }
  const expenses = await prisma.expense.aggregate({ where: { tenantId, storeId, createdAt }, _sum: { amount: true } });
  const grossProfit = revenue.sub(cost);
  const netProfit = grossProfit.sub(expenses._sum.amount ?? 0);

  res.json({ revenue, cost, grossProfit, expenses: expenses._sum.amount ?? 0, netProfit });
}

export async function expensesReport(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const createdAt = dateRange(req);
  const expenses = await prisma.expense.findMany({ where: { tenantId, storeId, createdAt }, orderBy: { createdAt: "desc" } });
  const byCategory = expenses.reduce<Record<string, Prisma.Decimal>>((acc, e) => {
    const key = e.category ?? "أخرى";
    acc[key] = (acc[key] ?? new Prisma.Decimal(0)).add(e.amount);
    return acc;
  }, {});
  res.json({ total: expenses.reduce((s, e) => s.add(e.amount), new Prisma.Decimal(0)), byCategory, expenses });
}

export async function inventoryValuationReport(req: Request, res: Response) {
  const products = await prisma.product.findMany({ where: { ...scope(req), isActive: true } });
  const rows = products.map((p) => ({
    id: p.id, name: p.name, stock: p.currentStock,
    costValue: p.purchasePrice.mul(p.currentStock),
    saleValue: p.salePrice.mul(p.currentStock),
  }));
  const totalCostValue = rows.reduce((s, r) => s.add(r.costValue), new Prisma.Decimal(0));
  const totalSaleValue = rows.reduce((s, r) => s.add(r.saleValue), new Prisma.Decimal(0));

  if (req.query.format === "xlsx") {
    return sendAsExcel(res, "inventory-valuation", rows.map((r) => ({
      "المنتج": r.name, "الكمية": r.stock.toString(), "قيمة التكلفة": r.costValue.toString(), "قيمة البيع": r.saleValue.toString(),
    })));
  }
  res.json({ totalCostValue, totalSaleValue, products: rows });
}

export async function lowStockReport(req: Request, res: Response) {
  const products = await prisma.product.findMany({
    where: { ...scope(req), isActive: true },
    select: { id: true, name: true, currentStock: true, minStock: true },
    orderBy: { currentStock: "asc" },
  });
  res.json(products.filter((product) => Number(product.currentStock) <= Number(product.minStock)).map((product) => ({
    id: product.id,
    name: product.name,
    current_stock: product.currentStock,
    min_stock: product.minStock,
  })));
}

export async function topProductsReport(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const createdAt = dateRange(req);
  const grouped = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: { sale: { tenantId, storeId, createdAt, status: { not: "cancelled" } } },
    _sum: { quantity: true, total: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 20,
  });
  const products = await prisma.product.findMany({ where: { id: { in: grouped.map((g) => g.productId) } } });
  const byId = new Map(products.map((p) => [p.id, p.name]));
  res.json(grouped.map((g) => ({ productId: g.productId, name: byId.get(g.productId), qtySold: g._sum.quantity, revenue: g._sum.total })));
}

export async function cancelledInvoicesReport(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const createdAt = dateRange(req);
  res.json(await prisma.sale.findMany({ where: { tenantId, storeId, createdAt, status: "cancelled" }, orderBy: { createdAt: "desc" } }));
}

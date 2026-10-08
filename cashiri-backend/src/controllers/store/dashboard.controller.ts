import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function parseDate(value: unknown, fallback: Date) {
  if (typeof value !== "string") return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export async function getMerchantDashboard(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const allStores = Boolean(req.auth?.allStoresAccess);
  const now = new Date();
  const from = parseDate(req.query.from, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const to = parseDate(req.query.to, now);
  to.setHours(23, 59, 59, 999);
  const createdAt = { gte: from, lte: to };

  const [sales, returns, payments, purchases, expenses, invoiceCount, customerCount, supplierCount, productCount, lowStock, outOfStock, installmentPlans, installmentDue, installmentOverdue] =
    await Promise.all([
      prisma.sale.aggregate({ where: { tenantId, storeId, status: { in: ["completed", "partially_returned"] }, createdAt }, _sum: { total: true, taxAmount: true }, _count: { id: true } }),
      prisma.saleReturn.aggregate({ where: { tenantId, storeId, createdAt }, _sum: { total: true } }),
      prisma.payment.aggregate({ where: { tenantId, storeId, createdAt }, _sum: { amount: true } }),
      prisma.purchase.aggregate({ where: { tenantId, storeId, createdAt }, _sum: { total: true, paidAmount: true } }),
      prisma.expense.aggregate({ where: { tenantId, storeId, createdAt }, _sum: { amount: true } }),
      prisma.sale.count({ where: { tenantId, storeId, createdAt } }),
      prisma.customer.count({ where: { tenantId, storeId } }),
      prisma.supplier.count({ where: { tenantId, storeId } }),
      prisma.product.count({ where: { tenantId, storeId, isActive: true } }),
      allStores
        ? prisma.$queryRaw<{ count: bigint }[]>`select count(*) from products where tenant_id = ${tenantId} and current_stock <= min_stock`
        : prisma.$queryRaw<{ count: bigint }[]>`select count(*) from products where tenant_id = ${tenantId} and store_id = ${storeId} and current_stock <= min_stock`,
      allStores
        ? prisma.$queryRaw<{ count: bigint }[]>`select count(*) from products where tenant_id = ${tenantId} and current_stock <= 0`
        : prisma.$queryRaw<{ count: bigint }[]>`select count(*) from products where tenant_id = ${tenantId} and store_id = ${storeId} and current_stock <= 0`,
      prisma.customerInstallmentPlan.aggregate({ where: { tenantId, storeId }, _sum: { totalAmount: true, remainingAmount: true } }),
      prisma.customerInstallment.aggregate({ where: { plan: { tenantId, storeId }, status: { in: ["due", "partially_paid"] } }, _sum: { remainingAmount: true } }),
      prisma.customerInstallment.aggregate({ where: { plan: { tenantId, storeId }, status: "overdue" }, _sum: { remainingAmount: true } }),
    ]);

  const salesTotal = Number(sales._sum.total ?? 0) - Number(returns._sum.total ?? 0);
  const taxTotal = Number(sales._sum.taxAmount ?? 0);
  const expensesTotal = Number(expenses._sum.amount ?? 0);

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    salesTotal,
    taxTotal,
    paymentsReceived: payments._sum.amount ?? 0,
    purchasesTotal: purchases._sum.total ?? 0,
    purchasesPaid: purchases._sum.paidAmount ?? 0,
    expensesTotal,
    netTotal: salesTotal - expensesTotal - taxTotal,
    installmentTotal: installmentPlans._sum.totalAmount ?? 0,
    installmentRemaining: installmentPlans._sum.remainingAmount ?? 0,
    installmentsDue: installmentDue._sum.remainingAmount ?? 0,
    installmentsOverdue: installmentOverdue._sum.remainingAmount ?? 0,
    invoiceCount,
    customerCount,
    supplierCount,
    productCount,
    lowStockCount: Number(lowStock[0]?.count ?? 0),
    outOfStockCount: Number(outOfStock[0]?.count ?? 0),
  });
}

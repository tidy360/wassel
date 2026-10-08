import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export async function getDashboard(req: Request, res: Response) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const parseDate = (value: unknown, fallback: Date) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  };
  const from = parseDate(req.query.from, defaultFrom);
  const selectedTo = parseDate(req.query.to, now);
  const to = new Date(selectedTo);
  to.setDate(to.getDate() + 1);
  if (from >= to) return res.status(400).json({ error: "يجب أن يكون تاريخ البداية قبل تاريخ النهاية" });
  const subscriptionDate = { gte: from, lt: to };
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalTenants,
    activeStores,
    suspendedStores,
    expiringIn7,
    expiringIn30,
    expiredSubscriptions,
    totalProducts,
    totalCustomers,
    totalSalesReps,
    totalSuppliers,
    totalSubscriptions,
    activeSubscriptions,
    subscriptionRevenue,
    repCommissionAgg,
    supervisorCommissionAgg,
    monthlySubscriptions,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.store.count({ where: { isActive: true } }),
    prisma.store.count({ where: { isActive: false } }),
    prisma.subscription.count({ where: { createdAt: subscriptionDate, status: "active", endDate: { gte: now, lte: in7Days } } }),
    prisma.subscription.count({ where: { createdAt: subscriptionDate, status: "active", endDate: { gte: now, lte: in30Days } } }),
    prisma.subscription.count({ where: { createdAt: subscriptionDate, status: "active", endDate: { lt: now } } }),
    prisma.$queryRaw<{ count: bigint }[]>`select count(*) from products`,
    prisma.$queryRaw<{ count: bigint }[]>`select count(*) from customers`,
    prisma.salesRep.count(),
    prisma.$queryRaw<{ count: bigint }[]>`select count(*) from suppliers`,
    prisma.subscription.count({ where: { createdAt: subscriptionDate } }),
    prisma.subscription.count({ where: { createdAt: subscriptionDate, status: "active", endDate: { gte: now } } }),
    prisma.subscription.aggregate({ where: { createdAt: subscriptionDate }, _sum: { amount: true } }),
    prisma.salesRepCommission.aggregate({ where: { createdAt: subscriptionDate }, _sum: { commissionAmount: true } }),
    prisma.salesSupervisorCommission.aggregate({ where: { createdAt: subscriptionDate }, _sum: { supervisorCommissionAmount: true } }),
    prisma.$queryRaw<{ month: string; count: bigint; revenue: string }[]>`
      select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
             count(*) as count,
             coalesce(sum(amount), 0)::text as revenue
      from subscriptions
      where created_at >= ${from} and created_at < ${to}
      group by date_trunc('month', created_at)
      order by date_trunc('month', created_at)
    `,
  ]);

  const monthlyMap = new Map(monthlySubscriptions.map((row) => [row.month, { count: Number(row.count), revenue: Number(row.revenue) }]));
  const firstMonth = new Date(from.getFullYear(), from.getMonth(), 1);
  const lastMonth = new Date(to.getFullYear(), to.getMonth(), 1);
  const subscriptionTrend = [];
  for (const month = new Date(firstMonth); month <= lastMonth; month.setMonth(month.getMonth() + 1)) {
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    subscriptionTrend.push({ month: key, count: monthlyMap.get(key)?.count ?? 0, revenue: monthlyMap.get(key)?.revenue ?? 0 });
  }

  res.json({
    totalTenants,
    activeStores,
    suspendedStores,
    subscriptionsExpiringIn7Days: expiringIn7,
    subscriptionsExpiringIn30Days: expiringIn30,
    expiredSubscriptions,
    totalProducts: Number(totalProducts[0]?.count ?? 0),
    totalCustomers: Number(totalCustomers[0]?.count ?? 0),
    totalSalesReps,
    totalSuppliers: Number(totalSuppliers[0]?.count ?? 0),
    totalSubscriptions,
    activeSubscriptions,
    totalSubscriptionRevenue: subscriptionRevenue._sum.amount ?? 0,
    totalRepCommissions: repCommissionAgg._sum.commissionAmount ?? 0,
    totalSupervisorCommissions: supervisorCommissionAgg._sum.supervisorCommissionAmount ?? 0,
    netSubscriptionProfit: new Prisma.Decimal(subscriptionRevenue._sum.amount ?? 0)
      .sub(repCommissionAgg._sum.commissionAmount ?? 0)
      .sub(supervisorCommissionAgg._sum.supervisorCommissionAmount ?? 0),
    subscriptionTrend,
  });
}

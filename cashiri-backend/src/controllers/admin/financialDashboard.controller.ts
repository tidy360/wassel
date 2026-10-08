import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

function parseDateRange(req: Request) {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  return { gte: from, lte: to };
}

export async function getFinancialDashboard(req: Request, res: Response) {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const createdAt = parseDateRange(req);

  const [
    totalSubscriptions,
    activeSubscriptions,
    expiredSubscriptions,
    expiringIn7,
    expiringIn30,
    subscriptionRevenueAgg,
    deferredPlansAgg,
    installmentsDueAgg,
    installmentsOverdueAgg,
    commissionAgg,
    commissionPaidAgg,
  ] = await Promise.all([
    prisma.subscription.count(),
    prisma.subscription.count({ where: { status: "active", endDate: { gte: now } } }),
    prisma.subscription.count({ where: { status: "active", endDate: { lt: now } } }),
    prisma.subscription.count({ where: { status: "active", endDate: { gte: now, lte: in7Days } } }),
    prisma.subscription.count({ where: { status: "active", endDate: { gte: now, lte: in30Days } } }),
    prisma.subscription.aggregate({ where: { createdAt }, _sum: { amount: true } }),
    prisma.tenantPaymentPlan.aggregate({ where: { planType: "deferred" }, _sum: { remainingAmount: true } }),
    prisma.installment.aggregate({ where: { status: { in: ["due", "partially_paid"] } }, _sum: { remainingAmount: true } }),
    prisma.installment.aggregate({ where: { status: "overdue" }, _sum: { remainingAmount: true } }),
    prisma.salesRepCommission.aggregate({ _sum: { commissionAmount: true, remainingAmount: true } }),
    prisma.salesRepCommission.aggregate({ _sum: { paidAmount: true } }),
  ]);

  res.json({
    totalSubscriptions,
    activeSubscriptions,
    expiredSubscriptions,
    subscriptionsExpiringIn7Days: expiringIn7,
    subscriptionsExpiringIn30Days: expiringIn30,
    totalPaymentsInRange: subscriptionRevenueAgg._sum.amount ?? new Prisma.Decimal(0),
    deferredPaymentsOutstanding: deferredPlansAgg._sum.remainingAmount ?? new Prisma.Decimal(0),
    installmentsDue: installmentsDueAgg._sum.remainingAmount ?? new Prisma.Decimal(0),
    installmentsOverdue: installmentsOverdueAgg._sum.remainingAmount ?? new Prisma.Decimal(0),
    totalRepCommissions: commissionAgg._sum.commissionAmount ?? new Prisma.Decimal(0),
    repCommissionsPaid: commissionPaidAgg._sum.paidAmount ?? new Prisma.Decimal(0),
    repCommissionsRemaining: commissionAgg._sum.remainingAmount ?? new Prisma.Decimal(0),
  });
}

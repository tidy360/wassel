import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function startOfToday() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function normalizeEligibilityRatio(value: Prisma.Decimal) {
  let best = new Prisma.Decimal(0);
  let smallestDifference = new Prisma.Decimal(1);
  for (let denominator = 1; denominator <= 12; denominator++) {
    for (let numerator = 0; numerator <= denominator; numerator++) {
      const candidate = new Prisma.Decimal(numerator).div(denominator);
      const difference = value.sub(candidate).abs();
      if (difference.lt(smallestDifference)) {
        smallestDifference = difference;
        best = candidate;
      }
    }
  }
  return best;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const subscriptions = await prisma.subscription.findMany({
    where: { createdAt: { gte: startOfToday() } },
    include: { plan: true, tenant: true },
    orderBy: { createdAt: "asc" },
  });

  for (const subscription of subscriptions) {
    const paidMonths = subscription.paidMonths ?? subscription.totalMonths ?? 1;
    const expectedAmount = new Prisma.Decimal(subscription.plan.price).mul(paidMonths);
    const commissions = await prisma.salesRepCommission.findMany({
      where: { paymentReference: `subscription:${subscription.id}` },
    });
    const assignments = await prisma.representativeMerchantAssignment.findMany({
      where: { merchantId: subscription.tenantId, representativeId: subscription.tenant.salesRepId ?? undefined },
      orderBy: { startDate: "asc" },
    });
    const corrections = [] as string[];
    if (apply && !subscription.amount.equals(expectedAmount)) {
      await prisma.subscription.update({ where: { id: subscription.id }, data: { amount: expectedAmount } });
      await prisma.auditLog.create({ data: { tenantId: subscription.tenantId, action: "subscription.amount.corrected", entity: "Subscription", entityId: subscription.id, beforeData: { amount: subscription.amount } as any, afterData: { amount: expectedAmount, reason: "plan price multiplied by paid months" } as any } });
      corrections.push("subscription");
    }

    for (const commission of commissions) {
      const originalBase = new Prisma.Decimal(commission.paymentAmount).mul(commission.commissionRate).div(100);
      const eligibilityRatio = originalBase.gt(0)
        ? normalizeEligibilityRatio(new Prisma.Decimal(commission.commissionAmount).div(originalBase))
        : new Prisma.Decimal(0);
      const correctedCommission = expectedAmount.mul(commission.commissionRate).div(100).mul(eligibilityRatio).toDecimalPlaces(2);
      const correctedRemaining = Prisma.Decimal.max(new Prisma.Decimal(0), correctedCommission.sub(commission.paidAmount));
      const correctedStatus = commission.paidAmount.gte(correctedCommission) ? "paid" : commission.paidAmount.gt(0) ? "partially_paid" : "due";
      if (apply) {
        await prisma.$transaction(async (tx) => {
          await tx.salesRepCommission.update({ where: { id: commission.id }, data: { paymentAmount: expectedAmount, commissionAmount: correctedCommission, remainingAmount: correctedRemaining, status: correctedStatus } });
          await tx.auditLog.create({ data: { tenantId: subscription.tenantId, action: "sales_rep_commission.corrected", entity: "SalesRepCommission", entityId: commission.id, beforeData: { paymentAmount: commission.paymentAmount, commissionAmount: commission.commissionAmount } as any, afterData: { paymentAmount: expectedAmount, commissionAmount: correctedCommission, eligibilityRatio } as any } });
          const supervisorCommissions = await tx.salesSupervisorCommission.findMany({ where: { paymentReference: commission.paymentReference } });
          for (const supervisorCommission of supervisorCommissions) {
            const supervisorAmount = correctedCommission.mul(supervisorCommission.commissionRate).div(100).toDecimalPlaces(2);
            const supervisorRemaining = Prisma.Decimal.max(new Prisma.Decimal(0), supervisorAmount.sub(supervisorCommission.paidAmount));
            const supervisorStatus = supervisorCommission.paidAmount.gte(supervisorAmount) ? "paid" : supervisorCommission.paidAmount.gt(0) ? "partially_paid" : "due";
            await tx.salesSupervisorCommission.update({ where: { id: supervisorCommission.id }, data: { paymentAmount: expectedAmount, repCommissionAmount: correctedCommission, supervisorCommissionAmount: supervisorAmount, ownerShareReductionAmount: supervisorAmount, remainingAmount: supervisorRemaining, status: supervisorStatus } });
            await tx.auditLog.create({ data: { tenantId: subscription.tenantId, action: "sales_supervisor_commission.corrected", entity: "SalesSupervisorCommission", entityId: supervisorCommission.id, beforeData: { paymentAmount: supervisorCommission.paymentAmount, supervisorCommissionAmount: supervisorCommission.supervisorCommissionAmount } as any, afterData: { paymentAmount: expectedAmount, supervisorCommissionAmount: supervisorAmount } as any } });
          }
        });
        corrections.push(`commission:${commission.id}`);
      }
    }

    console.log(JSON.stringify({
      subscriptionId: subscription.id,
      tenant: subscription.tenant.businessName,
      planPrice: subscription.plan.price.toString(),
      paidMonths,
      storedAmount: subscription.amount.toString(),
      expectedAmount: expectedAmount.toString(),
      assignments: assignments.map((assignment) => ({ start: assignment.startDate.toISOString().slice(0, 10), end: assignment.endDate.toISOString().slice(0, 10), months: assignment.durationMonths, status: assignment.status })),
      commissions: commissions.map((commission) => ({ id: commission.id, paymentAmount: commission.paymentAmount.toString(), commissionAmount: commission.commissionAmount.toString() })),
      applied: corrections,
    }));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
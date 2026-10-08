import { Prisma, PrismaClient } from "@prisma/client";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Creates a commission record for a tenant's sales rep when a subscription
 * payment happens, IF the tenant has a rep assigned. Idempotent per
 * `paymentReference` (unique per rep) — calling this twice for the same
 * subscription payment is a no-op the second time, which is what stops a
 * commission from ever being counted twice (spec section 4, 15).
 *
 * Call this from inside the same DB transaction as the payment itself.
 */
export async function recordCommissionIfApplicable(
  tx: Tx,
  params: {
    tenantId: string;
    paymentAmount: Prisma.Decimal | number;
    paymentReference: string;
    assignmentId?: string;
    eligibleMonths?: number;
    paymentMonths?: number;
  }
) {
  const tenant = await tx.tenant.findUnique({ where: { id: params.tenantId } });
  if (!tenant?.salesRepId) return null;

  const today = new Date();
  const assignmentHistory = await tx.representativeMerchantAssignment.count({ where: { merchantId: tenant.id } });
  const activeAssignment = params.assignmentId
    ? await tx.representativeMerchantAssignment.findFirst({ where: { id: params.assignmentId, merchantId: tenant.id, representativeId: tenant.salesRepId, status: "ACTIVE" } })
    : assignmentHistory
    ? await tx.representativeMerchantAssignment.findFirst({
        where: {
          merchantId: tenant.id,
          representativeId: tenant.salesRepId,
          status: { in: ["ACTIVE", "EXPIRING_SOON"] },
          startDate: { lte: today },
          endDate: { gte: today },
        },
        orderBy: { endDate: "desc" },
      })
    : null;
  if (assignmentHistory && !activeAssignment) return null;

  const rep = await tx.salesRep.findUnique({ where: { id: activeAssignment?.representativeId ?? tenant.salesRepId } });
  if (!rep || rep.status !== "active") return null;

  const existing = await tx.salesRepCommission.findUnique({
    where: { salesRepId_paymentReference: { salesRepId: rep.id, paymentReference: params.paymentReference } },
  });
  if (existing) return existing;

  const paymentAmount = new Prisma.Decimal(params.paymentAmount);
  const eligibleRatio = params.eligibleMonths !== undefined && params.paymentMonths
    ? new Prisma.Decimal(Math.max(0, Math.min(params.eligibleMonths, params.paymentMonths))).div(params.paymentMonths)
    : new Prisma.Decimal(1);
  if (eligibleRatio.lte(0)) return null;
  const commissionableAmount = paymentAmount.mul(eligibleRatio);
  const commissionAmount = commissionableAmount.mul(rep.commissionRate).div(100);

  const repCommission = await tx.salesRepCommission.create({
    data: {
      salesRepId: rep.id,
      tenantId: tenant.id,
      paymentReference: params.paymentReference,
      paymentAmount,
      commissionRate: rep.commissionRate,
      commissionAmount,
      remainingAmount: commissionAmount,
      status: "due",
    },
  });

  const supervisorAssignment = await tx.salesSupervisorRepAssignment.findFirst({
    where: { salesRepId: rep.id, status: "active" },
    orderBy: { createdAt: "desc" },
    include: { supervisor: true },
  });

  if (!supervisorAssignment || supervisorAssignment.supervisor.status !== "active") return repCommission;

  const supervisorRate = supervisorAssignment.supervisor.commissionRate;
  const supervisorCommissionAmount = commissionAmount.mul(supervisorRate).div(100);

  await tx.salesSupervisorCommission.upsert({
    where: {
      supervisorId_paymentReference: {
        supervisorId: supervisorAssignment.supervisorId,
        paymentReference: params.paymentReference,
      },
    },
    update: {},
    create: {
      supervisorId: supervisorAssignment.supervisorId,
      salesRepId: rep.id,
      tenantId: tenant.id,
      paymentReference: params.paymentReference,
      paymentAmount,
      repCommissionAmount: commissionAmount,
      commissionRate: supervisorRate,
      supervisorCommissionAmount,
      ownerShareReductionAmount: supervisorCommissionAmount,
      remainingAmount: supervisorCommissionAmount,
      status: "due",
    },
  });

  return repCommission;
}

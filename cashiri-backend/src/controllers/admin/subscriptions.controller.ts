import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { recordCommissionIfApplicable } from "../../lib/commission";

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ---------- Plans ----------

const planSchema = z.object({
  name: z.string().min(1),
  maxUsers: z.number().int().positive().nullable().optional(),
  maxBranches: z.number().int().positive().nullable().optional(),
  maxProducts: z.number().int().positive().nullable().optional(),
  features: z.record(z.any()).optional(),
  price: z.number().nonnegative(),
  isActive: z.boolean().optional(),
});

export async function listPlans(_req: Request, res: Response) {
  res.json(await prisma.subscriptionPlan.findMany({ orderBy: { price: "asc" } }));
}

export async function createPlan(req: Request, res: Response) {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const plan = await prisma.subscriptionPlan.create({ data: parsed.data });
  await logAudit(req, { action: "plan.created", entity: "SubscriptionPlan", entityId: plan.id, after: plan });
  res.status(201).json(plan);
}

export async function updatePlan(req: Request, res: Response) {
  const parsed = planSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const before = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Plan not found" });
  const plan = await prisma.subscriptionPlan.update({ where: { id: req.params.id }, data: parsed.data });
  await logAudit(req, { action: "plan.updated", entity: "SubscriptionPlan", entityId: plan.id, before, after: plan });
  res.json(plan);
}

// ---------- Subscriptions (duration-based renewal — spec section 1) ----------

const assignSchema = z.object({
  planId: z.string().uuid(),
  paidMonths: z.number().int().min(1),
  freeMonths: z.number().int().min(0).max(3).default(0),
  paymentMethod: z.enum(["cash", "transfer"]).default("cash"),
});

/**
 * Renews/assigns a subscription by DURATION, not manual dates (spec
 * section 1): the Supervisor picks paid months (1/3/6/12) + free months
 * (0-3), and the system computes start/end dates itself. If the tenant's
 * current subscription hasn't expired yet, the new period starts the day
 * after it ends rather than today, so an early renewal never loses paid
 * days. Also records the sales rep's commission on this payment, if any
 * (spec section 4) — guarded against double-counting via a unique
 * payment_reference tied to the new subscription's own id.
 */
export async function assignSubscription(req: Request, res: Response) {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { planId, paidMonths, freeMonths, paymentMethod } = parsed.data;
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) return res.status(404).json({ error: "Subscription plan not found or inactive" });
  const requestedTotalMonths = paidMonths + freeMonths;
  if (tenant.salesRepId && requestedTotalMonths > 12) {
    return res.status(400).json({ error: "A representative assignment cannot exceed 12 months" });
  }
  const storeCount = await prisma.store.count({ where: { tenantId: tenant.id } });
  if (plan.maxBranches != null && storeCount > plan.maxBranches) {
    return res.status(409).json({
      error: `لا يمكن تجديد هذه الباقة: التاجر لديه ${storeCount} فروع، والباقة تسمح بـ ${plan.maxBranches} فقط`,
    });
  }
  const result = await prisma.$transaction(async (tx) => {
    const activeSubscriptions = await tx.subscription.findMany({
      where: { tenantId: tenant.id, status: "active", endDate: { gte: new Date() } },
      orderBy: { endDate: "desc" },
      include: { plan: true },
    });
    const currentSubscription = activeSubscriptions.find((subscription) => subscription.startDate <= new Date());
    const renewalEndDate = activeSubscriptions[0]?.endDate;

    const isUpgrade = Boolean(currentSubscription && currentSubscription.planId !== planId && new Prisma.Decimal(plan.price).gt(currentSubscription.plan.price));
    const upgradeMonths = isUpgrade && renewalEndDate ? Math.max(1, wholeMonthsBetween(new Date(), renewalEndDate)) : 0;
    const effectivePaidMonths = isUpgrade ? upgradeMonths : paidMonths;
    const effectiveFreeMonths = isUpgrade ? 0 : freeMonths;
    const totalMonths = effectivePaidMonths + effectiveFreeMonths;
    const startDate = isUpgrade ? new Date() : renewalEndDate ? addDays(renewalEndDate, 1) : new Date();
    const endDate = isUpgrade ? renewalEndDate! : addMonths(startDate, totalMonths);
    const amount = isUpgrade
      ? new Prisma.Decimal(plan.price).sub(currentSubscription!.plan.price).mul(upgradeMonths)
      : new Prisma.Decimal(plan.price).mul(paidMonths);

    if (isUpgrade) {
      await tx.subscription.updateMany({ where: { tenantId: tenant.id, status: "active", endDate: { gte: new Date() } }, data: { status: "cancelled" } });
    }

    const sub = await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        planId,
        startDate,
        endDate,
        status: "active",
        paidMonths: effectivePaidMonths,
        freeMonths: effectiveFreeMonths,
        totalMonths,
        amount,
        paymentMethod,
        createdBy: req.auth!.userId,
      },
    });

    if (tenant.status === "trial" || tenant.status === "expired") {
      await tx.tenant.update({ where: { id: tenant.id }, data: { status: "active" } });
    }

    const previousAssignment = tenant.salesRepId
      ? await tx.representativeMerchantAssignment.findFirst({
          where: { merchantId: tenant.id, representativeId: tenant.salesRepId, status: { in: ["ACTIVE", "EXPIRING_SOON", "SUSPENDED", "EXPIRED"] } },
          orderBy: { startDate: "asc" },
        })
      : null;
    const relationshipStart = previousAssignment?.startDate ?? startDate;
    const relationshipEnd = addDays(addMonths(relationshipStart, 12), -1);
    const elapsedMonths = wholeMonthsBetween(relationshipStart, startDate);
    const eligibleMonths = Math.min(totalMonths, Math.max(0, 12 - elapsedMonths));
    const eligibleEnd = new Date(Math.min(addDays(endDate, -1).getTime(), relationshipEnd.getTime()));
    const assignment = tenant.salesRepId && eligibleMonths > 0
      ? previousAssignment
        ? await tx.representativeMerchantAssignment.update({
            where: { id: previousAssignment.id },
            data: {
              endDate: eligibleEnd,
              durationMonths: Math.min(12, elapsedMonths + eligibleMonths),
              status: "ACTIVE",
              terminatedAt: null,
              terminatedBy: null,
              terminationReason: null,
            },
          })
        : await tx.representativeMerchantAssignment.create({
            data: {
              tenantId: tenant.id,
              merchantId: tenant.id,
              representativeId: tenant.salesRepId,
              startDate,
              endDate: eligibleEnd,
              durationMonths: eligibleMonths,
              status: "ACTIVE",
              createdBy: req.auth!.userId,
            },
          })
      : null;

    const commission = await recordCommissionIfApplicable(tx, {
      tenantId: tenant.id,
      paymentAmount: amount,
      paymentReference: `subscription:${sub.id}`,
      assignmentId: assignment?.id,
      eligibleMonths,
      paymentMonths: totalMonths,
    });

    return { sub, commission, assignment, assignmentCreated: Boolean(assignment && !previousAssignment), isUpgrade };
  });

  await logAudit(req, {
    action: "subscription.assigned",
    entity: "Subscription",
    entityId: result.sub.id,
    after: { ...result.sub, commissionCreated: Boolean(result.commission), isUpgrade: result.isUpgrade },
  });
  if (result.assignment && result.assignmentCreated) {
    await logAudit(req, {
      action: "REPRESENTATIVE_ASSIGNED",
      entity: "RepresentativeMerchantAssignment",
      entityId: result.assignment.id,
      after: result.assignment,
    });
  } else if (result.assignment) {
    await logAudit(req, {
      action: "ASSIGNMENT_UPDATED",
      entity: "RepresentativeMerchantAssignment",
      entityId: result.assignment.id,
      after: result.assignment,
    });
  }
  res.status(201).json(result.sub);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function wholeMonthsBetween(start: Date, end: Date) {
  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  const anchor = new Date(start);
  anchor.setMonth(anchor.getMonth() + months);
  return anchor > end ? months - 1 : months;
}

export function setSubscriptionStatus(status: "active" | "cancelled") {
  return async (req: Request, res: Response) => {
    const before = await prisma.subscription.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Subscription not found" });
    const subscription = await prisma.subscription.update({ where: { id: req.params.id }, data: { status } });
    await logAudit(req, {
      action: status === "cancelled" ? "subscription.cancelled" : "subscription.reactivated",
      entity: "Subscription",
      entityId: subscription.id,
      before,
      after: subscription,
    });
    res.json(subscription);
  };
}

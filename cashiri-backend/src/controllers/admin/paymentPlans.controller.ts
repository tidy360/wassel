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

const createPlanSchema = z.object({
  subscriptionId: z.string().uuid().optional(),
  planType: z.enum(["full", "deferred", "installment"]),
  paymentMethod: z.enum(["cash", "transfer"]).default("cash"),
  baseAmount: z.number().positive(),
  adjustmentType: z.enum(["none", "interest", "discount"]).default("none"),
  adjustmentValueType: z.enum(["percent", "fixed"]).optional(),
  adjustmentValue: z.number().nonnegative().optional(),
  downPayment: z.number().nonnegative().default(0),
  dueDate: z.string().date().optional(), // for 'deferred'
  installmentMonths: z.number().int().positive().optional(), // for 'installment' — 2, 4, 6, 12
  notes: z.string().optional(),
});

/** Computes the final amount after an optional interest/discount adjustment (spec section 10). */
function applyAdjustment(baseAmount: number, type: "none" | "interest" | "discount", valueType?: "percent" | "fixed", value?: number) {
  if (type === "none" || !value) return baseAmount;
  const delta = valueType === "percent" ? (baseAmount * value) / 100 : value;
  return type === "interest" ? baseAmount + delta : Math.max(0, baseAmount - delta);
}

/**
 * Creates a deferred-payment or installment plan for a tenant's
 * subscription (spec sections 9-11). For 'installment', immediately
 * generates the full installment schedule, splitting (finalAmount -
 * downPayment) evenly across the chosen number of months, with any
 * rounding remainder absorbed into the last installment so the total
 * always reconciles exactly.
 */
export async function createPaymentPlan(req: Request, res: Response) {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { planType, paymentMethod, baseAmount, adjustmentType, adjustmentValueType, adjustmentValue, downPayment, dueDate, installmentMonths, notes, subscriptionId } = parsed.data;

  if (planType === "installment" && !installmentMonths) {
    return res.status(400).json({ error: "installmentMonths is required for installment plans" });
  }
  if (planType === "deferred" && !dueDate) {
    return res.status(400).json({ error: "dueDate is required for deferred plans" });
  }
  if (downPayment > baseAmount) {
    return res.status(400).json({ error: "Down payment cannot exceed the base amount" });
  }

  const finalAmount = applyAdjustment(baseAmount, adjustmentType, adjustmentValueType, adjustmentValue);
  const remainingAmount = new Prisma.Decimal(finalAmount).sub(downPayment);

  const result = await prisma.$transaction(async (tx) => {
    const plan = await tx.tenantPaymentPlan.create({
      data: {
        tenantId: tenant.id,
        subscriptionId,
        planType,
        paymentMethod,
        baseAmount,
        adjustmentType,
        adjustmentValueType,
        adjustmentValue: adjustmentValue ?? 0,
        finalAmount,
        downPayment,
        remainingAmount,
        dueDate: planType === "deferred" && dueDate ? new Date(dueDate) : undefined,
        installmentMonths: planType === "installment" ? installmentMonths : undefined,
        notes,
        createdBy: req.auth!.userId,
      },
    });

    // Down payment counts as an immediate commissionable payment.
    if (downPayment > 0) {
      await recordCommissionIfApplicable(tx, {
        tenantId: tenant.id,
        paymentAmount: downPayment,
        paymentReference: `payment_plan_down_payment:${plan.id}`,
      });
    }

    if (planType === "installment" && installmentMonths) {
      const monthlyBase = remainingAmount.div(installmentMonths).toDecimalPlaces(2);
      let allocated = new Prisma.Decimal(0);
      const rows = [];
      for (let i = 1; i <= installmentMonths; i++) {
        const isLast = i === installmentMonths;
        const amount = isLast ? remainingAmount.sub(allocated) : monthlyBase;
        allocated = allocated.add(amount);
        rows.push({
          paymentPlanId: plan.id,
          installmentNumber: i,
          dueDate: addMonths(new Date(), i), // one installment per month starting next month
          amount,
          remainingAmount: amount,
          status: i === 1 ? "due" : "not_due",
        });
      }
      await tx.installment.createMany({ data: rows });
    }

    return plan;
  });

  await logAudit(req, { action: "payment_plan.created", entity: "TenantPaymentPlan", entityId: result.id, after: { tenantId: tenant.id, planType, finalAmount } });
  const createdPlan = await prisma.tenantPaymentPlan.findUnique({
    where: { id: result.id },
    include: { installments: { orderBy: { installmentNumber: "asc" } } },
  });
  res.status(201).json(createdPlan);
}

export async function getPaymentPlan(req: Request, res: Response) {
  const plan = await prisma.tenantPaymentPlan.findUnique({
    where: { id: req.params.id },
    include: { installments: { orderBy: { installmentNumber: "asc" } } },
  });
  if (!plan) return res.status(404).json({ error: "Payment plan not found" });
  res.json(plan);
}

const payInstallmentSchema = z.object({ amount: z.number().positive() });

/**
 * Records a payment against one installment (spec section 11). Never lets
 * an installment go negative-remaining, and marks it paid/partially_paid
 * accordingly. Also opens up the NEXT installment (not_due -> due) once
 * this one is settled, so the schedule progresses naturally.
 */
export async function recordInstallmentPayment(req: Request, res: Response) {
  const parsed = payInstallmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const installment = await prisma.installment.findUnique({ where: { id: req.params.id }, include: { paymentPlan: true } });
  if (!installment) return res.status(404).json({ error: "Installment not found" });

  const paymentAmount = new Prisma.Decimal(parsed.data.amount);
  if (paymentAmount.gt(installment.remainingAmount)) {
    return res.status(409).json({ error: "Payment exceeds the remaining amount for this installment" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const newPaid = installment.paidAmount.add(paymentAmount);
    const newRemaining = installment.remainingAmount.sub(paymentAmount);
    const updated = await tx.installment.update({
      where: { id: installment.id },
      data: { paidAmount: newPaid, remainingAmount: newRemaining, status: newRemaining.lte(0) ? "paid" : "partially_paid" },
    });

    if (newRemaining.lte(0)) {
      const next = await tx.installment.findFirst({
        where: { paymentPlanId: installment.paymentPlanId, installmentNumber: installment.installmentNumber + 1, status: "not_due" },
      });
      if (next) await tx.installment.update({ where: { id: next.id }, data: { status: "due" } });
    }

    await recordCommissionIfApplicable(tx, {
      tenantId: installment.paymentPlan.tenantId,
      paymentAmount,
      paymentReference: `installment:${installment.id}`,
    });

    return updated;
  });

  await logAudit(req, { action: "installment.paid", entity: "Installment", entityId: result.id, after: result });
  res.json(result);
}

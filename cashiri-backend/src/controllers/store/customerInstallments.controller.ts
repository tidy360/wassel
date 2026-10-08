import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { scope } from "../../middleware/storeScope";

const paymentSchema = z.object({ amount: z.number().positive(), paymentMethodId: z.string().uuid().optional() });

export async function payCustomerInstallment(req: Request, res: Response) {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payment" });
  const installment = await prisma.customerInstallment.findFirst({ where: { id: req.params.id, plan: scope(req) }, include: { plan: true } });
  if (!installment) return res.status(404).json({ error: "Installment not found" });
  const amount = new Prisma.Decimal(parsed.data.amount);
  if (parsed.data.paymentMethodId) {
    const paymentMethod = await prisma.paymentMethod.findFirst({ where: { id: parsed.data.paymentMethodId, tenantId: installment.plan.tenantId, storeId: installment.plan.storeId, isActive: true } });
    if (!paymentMethod) return res.status(400).json({ error: "Invalid payment method" });
  }
  if (amount.gt(installment.remainingAmount)) return res.status(409).json({ error: "Payment exceeds installment balance" });

  const result = await prisma.$transaction(async (tx) => {
    const remaining = installment.remainingAmount.sub(amount);
    const updated = await tx.customerInstallment.update({ where: { id: installment.id }, data: { paidAmount: installment.paidAmount.add(amount), remainingAmount: remaining, status: remaining.lte(0) ? "paid" : "partially_paid" } });
    await tx.payment.create({ data: { tenantId: installment.plan.tenantId, storeId: installment.plan.storeId, partyType: "customer", partyId: installment.plan.customerId, amount, paymentMethodId: parsed.data.paymentMethodId, createdBy: req.auth!.userId } });
    await tx.customer.update({ where: { id: installment.plan.customerId }, data: { balance: { decrement: amount } } });
    if (remaining.lte(0)) {
      const next = await tx.customerInstallment.findFirst({ where: { planId: installment.planId, installmentNumber: installment.installmentNumber + 1, status: "not_due" } });
      if (next) await tx.customerInstallment.update({ where: { id: next.id }, data: { status: "due" } });
    }
    return updated;
  });
  await logAudit(req, { action: "customer_installment.paid", entity: "CustomerInstallment", entityId: result.id, after: result });
  res.json(result);
}
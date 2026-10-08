import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

const supervisorSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  commissionRate: z.number().min(0).max(100).default(5),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().date().optional(),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
  referenceNumber: z.string().optional(),
  proofFilePath: z.string().optional(),
});

export async function listSalesSupervisors(_req: Request, res: Response) {
  const supervisors = await prisma.salesSupervisor.findMany({
    orderBy: { createdAt: "desc" },
    include: { assignments: { where: { status: "active" }, select: { id: true } } },
  });
  res.json(supervisors.map(({ assignments, ...supervisor }) => ({ ...supervisor, repCount: assignments.length })));
}

export async function createSalesSupervisor(req: Request, res: Response) {
  const parsed = supervisorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const supervisor = await prisma.salesSupervisor.create({
    data: { ...parsed.data, createdBy: req.auth!.userId },
  });
  await logAudit(req, { action: "sales_supervisor.created", entity: "SalesSupervisor", entityId: supervisor.id, after: supervisor });
  res.status(201).json(supervisor);
}

export async function updateSalesSupervisor(req: Request, res: Response) {
  const parsed = supervisorSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const before = await prisma.salesSupervisor.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Sales supervisor not found" });
  const supervisor = await prisma.salesSupervisor.update({ where: { id: before.id }, data: parsed.data });
  await logAudit(req, { action: "sales_supervisor.updated", entity: "SalesSupervisor", entityId: supervisor.id, before, after: supervisor });
  res.json(supervisor);
}

export function setSalesSupervisorStatus(status: "active" | "disabled") {
  return async (req: Request, res: Response) => {
    const before = await prisma.salesSupervisor.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Sales supervisor not found" });
    const supervisor = await prisma.salesSupervisor.update({ where: { id: before.id }, data: { status } });
    await logAudit(req, { action: status === "active" ? "sales_supervisor.enabled" : "sales_supervisor.disabled", entity: "SalesSupervisor", entityId: supervisor.id, before, after: supervisor });
    res.json(supervisor);
  };
}

export async function assignRepToSupervisor(req: Request, res: Response) {
  const [supervisor, rep] = await Promise.all([
    prisma.salesSupervisor.findUnique({ where: { id: req.params.id } }),
    prisma.salesRep.findUnique({ where: { id: req.params.repId } }),
  ]);
  if (!supervisor) return res.status(404).json({ error: "Sales supervisor not found" });
  if (!rep) return res.status(404).json({ error: "Sales rep not found" });
  if (supervisor.status !== "active" || rep.status !== "active") return res.status(409).json({ error: "Supervisor and rep must be active" });

  const activeAssignment = await prisma.salesSupervisorRepAssignment.findFirst({ where: { salesRepId: rep.id, status: "active" } });
  if (activeAssignment && activeAssignment.supervisorId !== supervisor.id) {
    await prisma.salesSupervisorRepAssignment.update({ where: { id: activeAssignment.id }, data: { status: "reassigned" } });
  }

  const assignment = await prisma.salesSupervisorRepAssignment.upsert({
    where: { supervisorId_salesRepId: { supervisorId: supervisor.id, salesRepId: rep.id } },
    update: { status: "active" },
    create: { supervisorId: supervisor.id, salesRepId: rep.id, status: "active" },
  });
  await logAudit(req, { action: "sales_supervisor.rep_assigned", entity: "SalesSupervisorRepAssignment", entityId: assignment.id, after: assignment });
  res.status(201).json(assignment);
}

export async function removeRepFromSupervisor(req: Request, res: Response) {
  const assignment = await prisma.salesSupervisorRepAssignment.findUnique({
    where: { supervisorId_salesRepId: { supervisorId: req.params.id, salesRepId: req.params.repId } },
  });
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });
  const updated = await prisma.salesSupervisorRepAssignment.update({ where: { id: assignment.id }, data: { status: "removed" } });
  await logAudit(req, { action: "sales_supervisor.rep_removed", entity: "SalesSupervisorRepAssignment", entityId: updated.id, before: assignment, after: updated });
  res.json(updated);
}

export async function listSupervisorReps(req: Request, res: Response) {
  const supervisor = await prisma.salesSupervisor.findUnique({ where: { id: req.params.id } });
  if (!supervisor) return res.status(404).json({ error: "Sales supervisor not found" });
  const assignments = await prisma.salesSupervisorRepAssignment.findMany({
    where: { supervisorId: supervisor.id, status: "active" },
    include: { salesRep: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(assignments);
}

export async function getSalesSupervisorDashboard(req: Request, res: Response) {
  const supervisor = await prisma.salesSupervisor.findUnique({ where: { id: req.params.id } });
  if (!supervisor) return res.status(404).json({ error: "Sales supervisor not found" });
  const [repCount, commissionAgg, paymentAgg] = await Promise.all([
    prisma.salesSupervisorRepAssignment.count({ where: { supervisorId: supervisor.id, status: "active" } }),
    prisma.salesSupervisorCommission.aggregate({ where: { supervisorId: supervisor.id }, _sum: { paymentAmount: true, repCommissionAmount: true, supervisorCommissionAmount: true, paidAmount: true, remainingAmount: true } }),
    prisma.salesSupervisorPayment.aggregate({ where: { supervisorId: supervisor.id }, _sum: { amount: true } }),
  ]);
  res.json({ supervisor, repCount, commissions: commissionAgg._sum, totalPayments: paymentAgg._sum.amount ?? new Prisma.Decimal(0) });
}

export async function getSalesSupervisorReport(req: Request, res: Response) {
  const supervisor = await prisma.salesSupervisor.findUnique({ where: { id: req.params.id } });
  if (!supervisor) return res.status(404).json({ error: "Sales supervisor not found" });
  const [commissions, payments] = await Promise.all([
    prisma.salesSupervisorCommission.findMany({ where: { supervisorId: supervisor.id }, include: { salesRep: true }, orderBy: { createdAt: "desc" } }),
    prisma.salesSupervisorPayment.findMany({ where: { supervisorId: supervisor.id }, orderBy: { paymentDate: "desc" } }),
  ]);
  res.json({ supervisor, commissions, payments });
}

export async function createSalesSupervisorPayment(req: Request, res: Response) {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const supervisor = await prisma.salesSupervisor.findUnique({ where: { id: req.params.id } });
  if (!supervisor) return res.status(404).json({ error: "Sales supervisor not found" });

  const outstandingBefore = (await prisma.salesSupervisorCommission.aggregate({
    where: { supervisorId: supervisor.id, status: { in: ["due", "partially_paid"] } },
    _sum: { remainingAmount: true },
  }))._sum.remainingAmount ?? new Prisma.Decimal(0);
  const amount = new Prisma.Decimal(parsed.data.amount);
  if (amount.gt(outstandingBefore)) return res.status(409).json({ error: "Payment exceeds the supervisor's outstanding balance" });

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.salesSupervisorPayment.create({
      data: {
        supervisorId: supervisor.id,
        amount,
        paymentDate: parsed.data.paymentDate ? new Date(parsed.data.paymentDate) : new Date(),
        paymentMethod: parsed.data.paymentMethod,
        notes: parsed.data.notes,
        referenceNumber: parsed.data.referenceNumber,
        proofFilePath: parsed.data.proofFilePath,
        totalDueBefore: outstandingBefore,
        remainingAfter: outstandingBefore.sub(amount),
        createdBy: req.auth!.userId,
      },
    });

    const commissions = await tx.salesSupervisorCommission.findMany({
      where: { supervisorId: supervisor.id, status: { in: ["due", "partially_paid"] } },
      orderBy: { createdAt: "asc" },
    });
    let remaining = amount;
    for (const commission of commissions) {
      if (remaining.lte(0)) break;
      const applied = Prisma.Decimal.min(remaining, commission.remainingAmount);
      const newRemaining = commission.remainingAmount.sub(applied);
      await tx.salesSupervisorCommission.update({
        where: { id: commission.id },
        data: { paidAmount: commission.paidAmount.add(applied), remainingAmount: newRemaining, status: newRemaining.lte(0) ? "paid" : "partially_paid", paidAt: newRemaining.lte(0) ? new Date() : null },
      });
      await tx.salesSupervisorPaymentAllocation.create({ data: { salesSupervisorPaymentId: payment.id, salesSupervisorCommissionId: commission.id, amount: applied } });
      remaining = remaining.sub(applied);
    }
    return payment;
  });

  await logAudit(req, { action: "sales_supervisor.paid", entity: "SalesSupervisorPayment", entityId: result.id, after: result });
  res.status(201).json(result);
}

export async function listSalesSupervisorPayments(req: Request, res: Response) {
  const payments = await prisma.salesSupervisorPayment.findMany({ where: { supervisorId: req.params.id }, orderBy: { paymentDate: "desc" } });
  res.json(payments);
}

export async function getSalesSupervisorPaymentReceipt(req: Request, res: Response) {
  const payment = await prisma.salesSupervisorPayment.findUnique({ where: { id: req.params.id }, include: { supervisor: true } });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  const createdBy = payment.createdBy ? await prisma.user.findUnique({ where: { id: payment.createdBy } }) : null;
  res.json({ supervisorName: payment.supervisor.name, supervisorPhone: payment.supervisor.phone, amountPaid: payment.amount, paymentDate: payment.paymentDate, referenceNumber: payment.referenceNumber, totalDueBeforePayment: payment.totalDueBefore, remainingAfterPayment: payment.remainingAfter, recordedBy: createdBy?.name ?? null });
}

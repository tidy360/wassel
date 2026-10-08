import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

const repSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  commissionRate: z.number().min(0).max(100).default(30),
});

export async function listSalesReps(_req: Request, res: Response) {
  const reps = await prisma.salesRep.findMany({
    orderBy: { createdAt: "desc" },
    include: { tenants: { select: { id: true } } },
  });
  res.json(reps.map((r) => ({ ...r, tenantCount: r.tenants.length, tenants: undefined })));
}

export async function createSalesRep(req: Request, res: Response) {
  const parsed = repSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const rep = await prisma.salesRep.create({ data: { ...parsed.data, createdBy: req.auth!.userId } });
  await logAudit(req, { action: "sales_rep.created", entity: "SalesRep", entityId: rep.id, after: rep });
  res.status(201).json(rep);
}

export async function updateSalesRep(req: Request, res: Response) {
  const parsed = repSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const before = await prisma.salesRep.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Sales rep not found" });

  const rep = await prisma.salesRep.update({ where: { id: before.id }, data: parsed.data });
  await logAudit(req, { action: "sales_rep.updated", entity: "SalesRep", entityId: rep.id, before, after: rep });
  res.json(rep);
}

export function setSalesRepStatus(status: "active" | "disabled") {
  return async (req: Request, res: Response) => {
    const before = await prisma.salesRep.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Sales rep not found" });
    const rep = await prisma.salesRep.update({ where: { id: before.id }, data: { status } });
    await logAudit(req, { action: status === "disabled" ? "sales_rep.disabled" : "sales_rep.enabled", entity: "SalesRep", entityId: rep.id, before, after: rep });
    res.json(rep);
  };
}

/** Performance summary for one rep — spec section 2 ("مشاهدة أداء المندوب"). */
export async function getSalesRepPerformance(req: Request, res: Response) {
  const rep = await prisma.salesRep.findUnique({ where: { id: req.params.id } });
  if (!rep) return res.status(404).json({ error: "Sales rep not found" });

  const [tenantCount, commissionAgg, paidAgg] = await Promise.all([
    prisma.tenant.count({ where: { salesRepId: rep.id } }),
    prisma.salesRepCommission.aggregate({ where: { salesRepId: rep.id }, _sum: { commissionAmount: true, paidAmount: true, remainingAmount: true } }),
    prisma.salesRepPayment.aggregate({ where: { salesRepId: rep.id }, _sum: { amount: true } }),
  ]);

  res.json({
    rep,
    tenantCount,
    totalCommissions: commissionAgg._sum.commissionAmount ?? new Prisma.Decimal(0),
    totalPaidViaCommissions: commissionAgg._sum.paidAmount ?? new Prisma.Decimal(0),
    totalRemaining: commissionAgg._sum.remainingAmount ?? new Prisma.Decimal(0),
    totalPayments: paidAgg._sum.amount ?? new Prisma.Decimal(0),
  });
}

export async function getSalesRepStatement(req: Request, res: Response) {
  const rep = await prisma.salesRep.findUnique({ where: { id: req.params.id } });
  if (!rep) return res.status(404).json({ error: "Sales rep not found" });

  const [commissions, payments] = await Promise.all([
    prisma.salesRepCommission.findMany({ where: { salesRepId: rep.id }, orderBy: { createdAt: "desc" } }),
    prisma.salesRepPayment.findMany({ where: { salesRepId: rep.id }, orderBy: { paymentDate: "desc" } }),
  ]);
  res.json({ rep, commissions, payments });
}

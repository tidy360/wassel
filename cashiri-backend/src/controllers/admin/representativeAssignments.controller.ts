import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

const assignmentStatuses = ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "TERMINATED", "SUSPENDED"] as const;
const assignmentInput = z.object({
  merchantId: z.string().uuid(),
  storeId: z.string().uuid().nullable().optional(),
  representativeId: z.string().uuid(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  durationMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(9), z.literal(12)]),
});

function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function endForDuration(startDate: Date, durationMonths: number) {
  const end = new Date(startDate);
  end.setUTCMonth(end.getUTCMonth() + durationMonths);
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

function daysBetween(left: Date, right: Date) {
  return Math.max(0, Math.ceil((dateOnly(right).getTime() - dateOnly(left).getTime()) / 86400000));
}

function decorate<T extends { startDate: Date; endDate: Date; status: string }>(assignment: T) {
  const now = new Date();
  const totalDays = Math.max(1, daysBetween(assignment.startDate, assignment.endDate));
  const daysRemaining = assignment.status === "EXPIRED" || assignment.status === "TERMINATED"
    ? 0
    : daysBetween(now, assignment.endDate);
  return {
    ...assignment,
    daysRemaining,
    monthsRemaining: Math.max(0, Math.ceil(daysRemaining / 30.4375)),
    percentageCompleted: Math.min(100, Math.max(0, Math.round(((totalDays - daysRemaining) / totalDays) * 100))),
  };
}

async function expireDueAssignments(req: Request) {
  const due = await prisma.representativeMerchantAssignment.findMany({
    where: { status: { in: ["ACTIVE", "EXPIRING_SOON"] }, endDate: { lt: dateOnly(new Date()) } },
    include: { representative: true, merchant: true },
  });
  for (const assignment of due) {
    const updated = await prisma.representativeMerchantAssignment.updateMany({
      where: { id: assignment.id, status: { in: ["ACTIVE", "EXPIRING_SOON"] } },
      data: { status: "EXPIRED" },
    });
    if (updated.count) {
      await logAudit(req, {
        action: "ASSIGNMENT_EXPIRED",
        entity: "RepresentativeMerchantAssignment",
        entityId: assignment.id,
        before: assignment,
        after: { ...assignment, status: "EXPIRED" },
      });
    }
  }
}

function tenantScope(req: Request, merchantId?: string) {
  if (req.auth?.tenantId && merchantId && req.auth.tenantId !== merchantId) return { error: "Tenant access denied" };
  return { where: req.auth?.tenantId ? { merchantId: req.auth.tenantId } : {} };
}

function assertMerchantAccess(req: Request, merchantId: string) {
  if (req.auth?.tenantId && req.auth.tenantId !== merchantId) return false;
  return true;
}

export async function listRepresentativeAssignments(req: Request, res: Response) {
  await expireDueAssignments(req);
  const scope = tenantScope(req, typeof req.query.merchantId === "string" ? req.query.merchantId : undefined);
  if (scope.error) return res.status(403).json({ error: scope.error });
  const where: any = { ...scope.where };
  for (const key of ["merchantId", "representativeId", "status"] as const) {
    const value = req.query[key];
    if (typeof value === "string" && (key !== "status" || assignmentStatuses.includes(value as any))) where[key] = value;
  }
  const assignments = await prisma.representativeMerchantAssignment.findMany({
    where,
    include: { representative: true, merchant: true, store: true },
    orderBy: { endDate: "asc" },
  });
  res.json(assignments.map(decorate));
}

export async function getRepresentativeAssignment(req: Request, res: Response) {
  const assignment = await prisma.representativeMerchantAssignment.findUnique({
    where: { id: req.params.id },
    include: { representative: true, merchant: true, store: true },
  });
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });
  if (req.auth?.tenantId && assignment.merchantId !== req.auth.tenantId) return res.status(403).json({ error: "Tenant access denied" });
  res.json(decorate(assignment));
}

export async function createRepresentativeAssignment(req: Request, res: Response) {
  const parsed = assignmentInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid assignment: duration must be 1, 3, 6, 9, or 12 months", details: parsed.error.flatten() });
  const data = parsed.data;
  const startDate = dateOnly(data.startDate);
  const calculatedEndDate = dateOnly(endForDuration(startDate, data.durationMonths));
  const endDate = data.endDate ? dateOnly(data.endDate) : calculatedEndDate;
  if (endDate.getTime() !== calculatedEndDate.getTime()) return res.status(400).json({ error: "End date must match the selected duration" });
  if (endDate < startDate || daysBetween(startDate, endDate) > 366) return res.status(400).json({ error: "Assignment cannot exceed 12 months" });
  if (req.auth?.tenantId && req.auth.tenantId !== data.merchantId) return res.status(403).json({ error: "Tenant access denied" });

  const [merchant, representative, store, overlap] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: data.merchantId } }),
    prisma.salesRep.findUnique({ where: { id: data.representativeId } }),
    data.storeId ? prisma.store.findUnique({ where: { id: data.storeId } }) : null,
    prisma.representativeMerchantAssignment.findFirst({
      where: { representativeId: data.representativeId, merchantId: data.merchantId, status: { in: ["ACTIVE", "EXPIRING_SOON", "SUSPENDED"] }, startDate: { lte: endDate }, endDate: { gte: startDate } },
    }),
  ]);
  if (!merchant || !representative) return res.status(404).json({ error: "Merchant or representative not found" });
  if (representative.status !== "active") return res.status(409).json({ error: "Disabled representatives cannot be assigned" });
  if (store && store.tenantId !== data.merchantId) return res.status(400).json({ error: "Store does not belong to merchant" });
  if (overlap) return res.status(409).json({ error: "There is an active or overlapping assignment for this representative and merchant" });

  const assignment = await prisma.representativeMerchantAssignment.create({
    data: { tenantId: data.merchantId, merchantId: data.merchantId, storeId: data.storeId ?? null, representativeId: data.representativeId, startDate, endDate, durationMonths: data.durationMonths, status: endDate < dateOnly(new Date()) ? "EXPIRED" : "ACTIVE", createdBy: req.auth?.userId },
    include: { representative: true, merchant: true, store: true },
  });
  await logAudit(req, { action: "REPRESENTATIVE_ASSIGNED", entity: "RepresentativeMerchantAssignment", entityId: assignment.id, after: assignment });
  res.status(201).json(decorate(assignment));
}

export async function renewRepresentativeAssignment(req: Request, res: Response) {
  const previous = await prisma.representativeMerchantAssignment.findUnique({ where: { id: req.params.id } });
  if (!previous) return res.status(404).json({ error: "Assignment not found" });
  if (previous.status !== "EXPIRED" && previous.status !== "TERMINATED") return res.status(409).json({ error: "Only expired or terminated assignments can be renewed" });
  req.body = { ...req.body, merchantId: previous.merchantId, representativeId: previous.representativeId, storeId: previous.storeId, startDate: req.body.startDate ?? new Date(Math.max(Date.now(), previous.endDate.getTime() + 86400000)), durationMonths: req.body.durationMonths };
  const originalJson = res.json.bind(res);
  let created: any;
  res.json = (body: any) => { created = body; return originalJson(body); };
  await createRepresentativeAssignment(req, res);
  if (created?.id) await logAudit(req, { action: "ASSIGNMENT_RENEWED", entity: "RepresentativeMerchantAssignment", entityId: created.id, before: previous, after: created });
}

export async function updateRepresentativeAssignment(req: Request, res: Response) {
  const current = await prisma.representativeMerchantAssignment.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Assignment not found" });
  if (!assertMerchantAccess(req, current.merchantId)) return res.status(403).json({ error: "Tenant access denied" });
  const parsed = z.object({ startDate: z.coerce.date().optional(), durationMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(9), z.literal(12)]).optional(), storeId: z.string().uuid().nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid assignment update" });
  const startDate = dateOnly(parsed.data.startDate ?? current.startDate);
  const durationMonths = parsed.data.durationMonths ?? current.durationMonths;
  const endDate = dateOnly(endForDuration(startDate, durationMonths));
  if (parsed.data.storeId) {
    const store = await prisma.store.findUnique({ where: { id: parsed.data.storeId }, select: { tenantId: true } });
    if (!store || store.tenantId !== current.merchantId) return res.status(400).json({ error: "Store does not belong to merchant" });
  }
  const overlap = await prisma.representativeMerchantAssignment.findFirst({ where: { id: { not: current.id }, merchantId: current.merchantId, representativeId: current.representativeId, status: { in: ["ACTIVE", "EXPIRING_SOON", "SUSPENDED"] }, startDate: { lte: endDate }, endDate: { gte: startDate } } });
  if (overlap) return res.status(409).json({ error: "There is an active or overlapping assignment for this representative and merchant" });
  const updated = await prisma.representativeMerchantAssignment.update({ where: { id: current.id }, data: { startDate, endDate, durationMonths, storeId: parsed.data.storeId === undefined ? current.storeId : parsed.data.storeId } });
  await logAudit(req, { action: "ASSIGNMENT_UPDATED", entity: "RepresentativeMerchantAssignment", entityId: updated.id, before: current, after: updated });
  res.json(updated);
}

export async function terminateRepresentativeAssignment(req: Request, res: Response) {
  const reason = z.string().min(1).safeParse(req.body?.terminationReason);
  if (!reason.success) return res.status(400).json({ error: "Termination reason is required" });
  const assignment = await prisma.representativeMerchantAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });
  if (req.auth?.tenantId && assignment.merchantId !== req.auth.tenantId) return res.status(403).json({ error: "Tenant access denied" });
  const updated = await prisma.representativeMerchantAssignment.update({ where: { id: assignment.id }, data: { status: "TERMINATED", terminatedAt: new Date(), terminatedBy: req.auth?.userId, terminationReason: reason.data } });
  await logAudit(req, { action: "ASSIGNMENT_TERMINATED", entity: "RepresentativeMerchantAssignment", entityId: updated.id, before: assignment, after: updated });
  res.json(updated);
}

export async function suspendRepresentativeAssignment(req: Request, res: Response) {
  const assignment = await prisma.representativeMerchantAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });
  if (!assertMerchantAccess(req, assignment.merchantId)) return res.status(403).json({ error: "Tenant access denied" });
  const updated = await prisma.representativeMerchantAssignment.update({ where: { id: assignment.id }, data: { status: "SUSPENDED" } });
  await logAudit(req, { action: "ASSIGNMENT_SUSPENDED", entity: "RepresentativeMerchantAssignment", entityId: updated.id, before: assignment, after: updated });
  res.json(updated);
}

export async function reactivateRepresentativeAssignment(req: Request, res: Response) {
  const assignment = await prisma.representativeMerchantAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });
  if (!assertMerchantAccess(req, assignment.merchantId)) return res.status(403).json({ error: "Tenant access denied" });
  if (assignment.endDate < dateOnly(new Date())) return res.status(409).json({ error: "Expired assignments must be renewed" });
  const updated = await prisma.representativeMerchantAssignment.update({ where: { id: assignment.id }, data: { status: "ACTIVE" } });
  await logAudit(req, { action: "REACTIVATED", entity: "RepresentativeMerchantAssignment", entityId: updated.id, before: assignment, after: updated });
  res.json(updated);
}

export async function listExpiringAssignments(req: Request, res: Response) {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 30));
  const end = new Date(Date.now() + days * 86400000);
  const assignments = await prisma.representativeMerchantAssignment.findMany({ where: { ...(req.auth?.tenantId ? { merchantId: req.auth.tenantId } : {}), status: { in: ["ACTIVE", "EXPIRING_SOON"] }, endDate: { gte: dateOnly(new Date()), lte: dateOnly(end) } }, include: { representative: true, merchant: true }, orderBy: { endDate: "asc" } });
  res.json(assignments.map(decorate));
}

export const listAssignmentHistory = listRepresentativeAssignments;
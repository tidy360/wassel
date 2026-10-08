import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { scope } from "../middleware/storeScope";
import { logAudit } from "../lib/audit";

const priorities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const priorityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const statuses = ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_MERCHANT", "WAITING_FOR_REPRESENTATIVE", "RESOLVED", "CLOSED", "CANCELLED", "REOPENED"] as const;
const ticketInput = z.object({
  subject: z.string().trim().min(3).max(180),
  description: z.string().trim().min(3).max(10000),
  categoryId: z.string().uuid().optional(),
  categoryName: z.string().trim().min(1).max(80).optional(),
  priority: z.enum(priorities).optional(),
  invoiceReference: z.string().trim().max(100).optional(),
  orderReference: z.string().trim().max(100).optional(),
  productReference: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  bestContactTime: z.string().trim().max(100).optional(),
  fileAssetIds: z.array(z.string().uuid()).max(5).optional(),
});
const messageInput = z.object({ message: z.string().trim().min(1).max(10000), fileAssetId: z.string().uuid().optional() });

async function nextTicketNumber() {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `TKT-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
    if (!(await prisma.supportTicket.findUnique({ where: { ticketNumber: candidate }, select: { id: true } }))) return candidate;
  }
  return `TKT-${year}-${Date.now().toString().slice(-6)}`;
}

async function currentRepresentative(tenantId: string, storeId: string) {
  return prisma.representativeMerchantAssignment.findFirst({
    where: { merchantId: tenantId, OR: [{ storeId }, { storeId: null }], status: { in: ["ACTIVE", "EXPIRING_SOON"] }, startDate: { lte: new Date() }, endDate: { gte: new Date() } },
    include: { representative: true },
    orderBy: { endDate: "asc" },
  });
}

export async function getMerchantRepresentative(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const assignment = await currentRepresentative(tenantId, storeId);
  if (!assignment) return res.json(null);
  const phone = assignment.representative.phone?.replace(/^0/, "+249") ?? null;
  res.json({ name: assignment.representative.name, phone, status: assignment.representative.status, startDate: assignment.startDate, endDate: assignment.endDate });
}

async function notify(tenantId: string, storeId: string | null, type: string, message: string) {
  await prisma.notification.create({ data: { tenantId, storeId, type, message } });
}

async function notifySupportTeam(tenantId: string, type: string, message: string) {
  await prisma.notification.create({ data: { tenantId, storeId: null, type: `admin_${type}`, message } });
}

function merchantWhere(req: Request, id: string) {
  const { tenantId, storeId } = scope(req);
  return { id, tenantId, storeId };
}

export async function listMerchantTickets(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const tickets = await prisma.supportTicket.findMany({ where: { tenantId, storeId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], include: { messages: { orderBy: { createdAt: "desc" }, take: 1 }, ratings: true } });
  res.json(tickets);
}

export async function getMerchantTicket(req: Request, res: Response) {
  const ticket = await prisma.supportTicket.findFirst({ where: merchantWhere(req, req.params.id), include: { messages: { orderBy: { createdAt: "asc" } }, attachments: true, statusHistory: { orderBy: { createdAt: "asc" } }, ratings: true } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  res.json(ticket);
}

export async function createMerchantTicket(req: Request, res: Response) {
  const parsed = ticketInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid ticket input", details: parsed.error.flatten() });
  const { tenantId, storeId } = scope(req);
  const category = parsed.data.categoryId ? await prisma.supportTicketCategory.findFirst({ where: { id: parsed.data.categoryId, isActive: true } }) : null;
  if (parsed.data.categoryId && !category) return res.status(400).json({ error: "Invalid support category" });
  const assignment = await currentRepresentative(tenantId, storeId);
  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNumber: await nextTicketNumber(), tenantId, storeId, createdBy: req.auth!.userId,
      categoryId: category?.id, categoryName: category?.name ?? parsed.data.categoryName ?? "أخرى",
      subject: parsed.data.subject, description: parsed.data.description, priority: parsed.data.priority ?? category?.defaultPriority ?? "MEDIUM",
      invoiceReference: parsed.data.invoiceReference, orderReference: parsed.data.orderReference, productReference: parsed.data.productReference,
      contactPhone: parsed.data.contactPhone, bestContactTime: parsed.data.bestContactTime,
      representativeId: assignment?.representativeId, representativeName: assignment?.representative.name, representativePhone: assignment?.representative.phone,
      assignmentStartDate: assignment?.startDate, assignmentEndDate: assignment?.endDate,
      messages: { create: { senderId: req.auth!.userId, senderType: "MERCHANT", message: parsed.data.description } },
      attachments: parsed.data.fileAssetIds?.length ? { create: parsed.data.fileAssetIds.map((fileAssetId) => ({ fileAssetId, uploadedBy: req.auth!.userId })) } : undefined,
    },
    include: { messages: true, attachments: true },
  });
  await logAudit(req, { action: "support.ticket.created", entity: "SupportTicket", entityId: ticket.id, after: ticket });
  await notify(tenantId, storeId, "support_ticket_created", `تم استلام بلاغك رقم ${ticket.ticketNumber}`);
  await notifySupportTeam(tenantId, "support_ticket_created", `شكوى جديدة ${ticket.ticketNumber}: ${ticket.subject}`);
  res.status(201).json(ticket);
}

async function findAdminTicket(id: string) {
  return prisma.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } }, internalNotes: { orderBy: { createdAt: "asc" } }, attachments: true, statusHistory: { orderBy: { createdAt: "asc" } }, ratings: true } });
}

export async function listAdminTickets(req: Request, res: Response) {
  const where: any = {};
  if (typeof req.query.status === "string" && statuses.includes(req.query.status as any)) where.status = req.query.status;
  if (typeof req.query.priority === "string" && priorities.includes(req.query.priority as any)) where.priority = req.query.priority;
  if (typeof req.query.tenantId === "string") where.tenantId = req.query.tenantId;
  const tickets = await prisma.supportTicket.findMany({ where, orderBy: [{ slaBreached: "desc" }, { createdAt: "asc" }], include: { messages: { orderBy: { createdAt: "desc" }, take: 1 }, ratings: true } });
  tickets.sort((left, right) => (priorityRank[left.priority] ?? 99) - (priorityRank[right.priority] ?? 99) || left.createdAt.getTime() - right.createdAt.getTime());
  res.json(tickets);
}

export async function getAdminTicket(req: Request, res: Response) {
  const ticket = await findAdminTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const [merchant, store] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: ticket.tenantId }, select: { id: true, businessName: true, phone: true, email: true, status: true } }),
    ticket.storeId ? prisma.store.findUnique({ where: { id: ticket.storeId }, select: { id: true, name: true, phone: true, address: true } }) : null,
  ]);
  res.json({ ...ticket, merchant, store });
}

export async function addTicketMessage(req: Request, res: Response) {
  const parsed = messageInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message is required" });
  const ticket = req.auth?.tenantId ? await prisma.supportTicket.findFirst({ where: merchantWhere(req, req.params.id) }) : await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const senderType = req.auth?.tenantId ? "MERCHANT" : "CUSTOMER_SERVICE";
  const message = await prisma.supportTicketMessage.create({ data: { ticketId: ticket.id, senderId: req.auth!.userId, senderType, message: parsed.data.message, attachmentId: parsed.data.fileAssetId } });
  await logAudit(req, { action: "support.ticket.reply_added", entity: "SupportTicketMessage", entityId: message.id, after: message });
  if (senderType === "MERCHANT") await notifySupportTeam(ticket.tenantId, "support_ticket_reply", `رد جديد من التاجر على البلاغ ${ticket.ticketNumber}`);
  else await notify(ticket.tenantId, ticket.storeId, "support_ticket_reply", `رد خدمة العملاء على البلاغ ${ticket.ticketNumber}`);
  res.status(201).json(message);
}

export async function changeTicketStatus(req: Request, res: Response) {
  const parsed = z.object({ status: z.enum(statuses) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid ticket status" });
  const ticket = await findAdminTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: parsed.data.status, resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : ticket.resolvedAt, closedAt: parsed.data.status === "CLOSED" ? new Date() : ticket.closedAt } });
    await tx.supportTicketStatusHistory.create({ data: { ticketId: ticket.id, changedBy: req.auth!.userId, oldStatus: ticket.status, newStatus: parsed.data.status } });
    return next;
  });
  await logAudit(req, { action: parsed.data.status === "RESOLVED" ? "support.ticket.resolved" : "support.ticket.status_changed", entity: "SupportTicket", entityId: ticket.id, before: { status: ticket.status }, after: { status: updated.status } });
  const statusMessage = parsed.data.status === "RESOLVED" ? `تم حل البلاغ ${ticket.ticketNumber}` : `حالة البلاغ ${ticket.ticketNumber}: ${updated.status}`;
  await notify(ticket.tenantId, ticket.storeId, "support_ticket_status", statusMessage);
  await notifySupportTeam(ticket.tenantId, "support_ticket_status", statusMessage);
  res.json(updated);
}

export async function changeTicketPriority(req: Request, res: Response) {
  const parsed = z.object({ priority: z.enum(priorities) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid ticket priority" });
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const updated = await prisma.supportTicket.update({ where: { id: ticket.id }, data: { priority: parsed.data.priority } });
  await logAudit(req, { action: "support.ticket.priority_changed", entity: "SupportTicket", entityId: ticket.id, before: { priority: ticket.priority }, after: { priority: updated.priority } });
  res.json(updated);
}

export async function addInternalNote(req: Request, res: Response) {
  const parsed = z.object({ note: z.string().trim().min(1).max(10000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Note is required" });
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const note = await prisma.supportTicketInternalNote.create({ data: { ticketId: ticket.id, authorId: req.auth!.userId, note: parsed.data.note } });
  await logAudit(req, { action: "support.ticket.internal_note_added", entity: "SupportTicketInternalNote", entityId: note.id, after: note });
  res.status(201).json(note);
}

export async function listAdminSupportNotifications(_req: Request, res: Response) {
  const notifications = await prisma.notification.findMany({ where: { type: { startsWith: "admin_support_ticket" } }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json(notifications);
}

export async function markAdminSupportNotificationRead(req: Request, res: Response) {
  const notification = await prisma.notification.findFirst({ where: { id: req.params.id, type: { startsWith: "admin_support_ticket" } } });
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  res.json(await prisma.notification.update({ where: { id: notification.id }, data: { isRead: true } }));
}

export async function rateMerchantTicket(req: Request, res: Response) {
  const parsed = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Rating must be between 1 and 5" });
  const ticket = await prisma.supportTicket.findFirst({ where: merchantWhere(req, req.params.id) });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const rating = await prisma.supportTicketRating.upsert({ where: { ticketId_tenantId: { ticketId: ticket.id, tenantId: ticket.tenantId } }, update: parsed.data, create: { ticketId: ticket.id, tenantId: ticket.tenantId, ...parsed.data } });
  await logAudit(req, { action: "support.ticket.rated", entity: "SupportTicketRating", entityId: rating.id, after: rating });
  res.status(201).json(rating);
}

export async function listSupportCategories(_req: Request, res: Response) { res.json(await prisma.supportTicketCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })); }
export async function manageSupportCategory(req: Request, res: Response) {
  const parsed = z.object({ name: z.string().trim().min(1), defaultPriority: z.enum(priorities).default("MEDIUM"), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid category" });
  const category = req.params.id
    ? await prisma.supportTicketCategory.update({ where: { id: req.params.id }, data: parsed.data })
    : await prisma.supportTicketCategory.create({ data: parsed.data });
  await logAudit(req, { action: req.params.id ? "support.category.updated" : "support.category.created", entity: "SupportTicketCategory", entityId: category.id, after: category });
  res.status(req.params.id ? 200 : 201).json(category);
}

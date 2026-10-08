import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";

export async function listAuditLog(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
  const where = scope(req);

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ data: logs, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

export async function listNotifications(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const notifications = await prisma.notification.findMany({
    where: { tenantId, OR: [{ storeId }, { storeId: null }] },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(notifications);
}

export async function markNotificationRead(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const existing = await prisma.notification.findFirst({ where: { id: req.params.id, tenantId, OR: [{ storeId }, { storeId: null }] } });
  if (!existing) return res.status(404).json({ error: "Notification not found" });
  res.json(await prisma.notification.update({ where: { id: existing.id }, data: { isRead: true } }));
}

import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

export async function listAdminAuditLog(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
  const { tenantId } = req.query;

  const where: any = { storeId: null }; // platform-level actions only (store-level actions have their own audit view)
  if (typeof tenantId === "string") where.tenantId = tenantId;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ data: logs, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

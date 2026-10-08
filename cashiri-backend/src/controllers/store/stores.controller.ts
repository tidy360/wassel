import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

function requireAllStores(req: Request, res: Response) {
  if (!req.auth?.allStoresAccess) {
    res.status(403).json({ error: "Merchant owner access required" });
    return false;
  }
  return true;
}

export async function listMyStores(req: Request, res: Response) {
  if (!requireAllStores(req, res)) return;
  const stores = await prisma.store.findMany({
    where: { tenantId: req.auth!.tenantId! },
    include: { _count: { select: { users: true, branches: true } } },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
  });
  res.json(stores);
}

export async function setMyStoreStatus(req: Request, res: Response) {
  if (!requireAllStores(req, res)) return;
  const store = await prisma.store.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId! } });
  if (!store) return res.status(404).json({ error: "Store not found" });
  if (store.isMain && req.body.isActive === false) return res.status(409).json({ error: "لا يمكن تعطيل الفرع الرئيسي" });
  if (typeof req.body.isActive !== "boolean") return res.status(400).json({ error: "isActive must be boolean" });
  const updated = await prisma.store.update({ where: { id: store.id }, data: { isActive: req.body.isActive } });
  await logAudit(req, { action: updated.isActive ? "store.activated" : "store.suspended", entity: "Store", entityId: updated.id, before: store, after: updated });
  res.json(updated);
}

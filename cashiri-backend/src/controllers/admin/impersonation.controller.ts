import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { signAuthToken } from "../../lib/token";
import { logAudit } from "../../lib/audit";

const impersonateSchema = z.object({ targetUserId: z.string().uuid() });

/**
 * Issues a short-lived token scoped to a real user inside the target
 * store, tagged `impersonating: true` so the frontend can show a
 * persistent banner and the backend can block destructive actions
 * (see middleware/impersonation.ts). Always audit-logged.
 */
export async function startImpersonation(req: Request, res: Response) {
  const parsed = impersonateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const store = await prisma.store.findFirst({ where: { id: req.params.storeId, tenantId: req.params.tenantId } });
  if (!store) return res.status(404).json({ error: "Store not found" });

  const targetUser = await prisma.user.findFirst({
    where: { id: parsed.data.targetUserId, tenantId: store.tenantId, storeId: store.id, status: "active" },
    include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
  });
  if (!targetUser) return res.status(404).json({ error: "Target user not found in this store" });

  const roles = targetUser.userRoles.map((ur) => ur.role.name);
  const permissions = Array.from(new Set(targetUser.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code))));

  const token = signAuthToken({
    userId: targetUser.id,
    tenantId: targetUser.tenantId,
    storeId: targetUser.storeId,
    isSuperAdmin: false,
    roles,
    permissions,
    impersonating: true,
    impersonatedBy: req.auth!.userId,
  });

  await logAudit(req, {
    action: "impersonation.started",
    entity: "Store",
    entityId: store.id,
    after: { asUserId: targetUser.id, asUserEmail: targetUser.email },
  });

  res.json({
    token,
    user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, tenantId: targetUser.tenantId, storeId: targetUser.storeId, isSuperAdmin: false, roles, impersonating: true },
    warning: "أنت الآن تعمل داخل حساب متجر آخر (وضع محاكاة) — العمليات الحساسة معطّلة.",
  });
}

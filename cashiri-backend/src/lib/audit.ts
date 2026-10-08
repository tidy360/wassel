import { Request } from "express";
import { prisma } from "./prisma";

/**
 * Record a sensitive operation (spec section 19). Call this from
 * controllers after a create/update/delete/suspend/etc succeeds — never
 * before, so we don't log actions that failed partway through.
 */
export async function logAudit(
  req: Request,
  params: {
    action: string; // e.g. "tenant.created", "store.suspended", "subscription.extended"
    entity?: string; // e.g. "Tenant", "Store"
    entityId?: string;
    before?: unknown;
    after?: unknown;
  }
) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: req.auth?.tenantId ?? null,
        storeId: req.auth?.storeId ?? null,
        userId: req.auth?.userId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        beforeData: params.before as any,
        afterData: params.after as any,
        ipAddress: req.ip,
      },
    });
  } catch (err) {
    // Never let audit logging break the actual request.
    console.error("Failed to write audit log:", err);
  }
}

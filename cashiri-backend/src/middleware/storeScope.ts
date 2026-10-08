import { NextFunction, Request, Response } from "express";

/** Require the caller to be a logged-in store user (not the platform Super Admin, and not missing a store). */
export function requireStoreUser(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.isSuperAdmin) {
    return res.status(400).json({ error: "Use the /api/admin endpoints as Super Admin" });
  }
  if (!req.auth?.tenantId || !req.auth?.storeId) {
    return res.status(403).json({ error: "This account is not attached to a store" });
  }
  return next();
}

/** Shorthand for the (tenantId, storeId) pair every store-scoped Prisma query must filter by. */
export function scope(req: Request) {
  const explicitStoreId = typeof req.query.storeId === "string" && req.query.storeId.trim() ? req.query.storeId : null;

  // The first ADMIN owns the merchant scope. Reads and ID-based updates may
  // span all stores unless a specific branch is requested explicitly.
  return {
    tenantId: req.auth!.tenantId as string,
    storeId: explicitStoreId ?? (req.auth!.allStoresAccess ? undefined : req.auth!.storeId as string),
  };
}

export function primaryStoreId(req: Request) {
  return req.auth!.storeId as string;
}

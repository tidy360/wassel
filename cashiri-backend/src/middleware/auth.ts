import { NextFunction, Request, Response } from "express";
import { verifyAuthToken } from "../lib/token";

/**
 * Verifies the Bearer token and attaches { userId, tenantId, storeId,
 * isSuperAdmin, roles, permissions } to req.auth.
 *
 * This is the ONLY place tenant/store identity is trusted from — never from
 * a request body, query string, or URL param. Every downstream handler
 * must scope its Prisma queries using req.auth.tenantId / req.auth.storeId,
 * never a client-supplied one (see tenantIsolation.ts).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyAuthToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Only allow the platform Super Admin through (section 2 / 32). */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.isSuperAdmin) {
    return res.status(403).json({ error: "Super Admin access required" });
  }
  return next();
}

/**
 * Allows the platform Super Admin AND any platform-level staff account
 * (Accountant, Customer Service — spec section 8) through to /api/admin.
 * A "platform-level" user is one with no tenantId/storeId — i.e. not tied
 * to any single merchant. Fine-grained access within the admin area is
 * then enforced per-route with requirePermission().
 */
export function requirePlatformUser(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.isSuperAdmin) return next();
  if (!req.auth?.tenantId && !req.auth?.storeId) return next();
  return res.status(403).json({ error: "Platform staff access required" });
}

import { NextFunction, Request, Response } from "express";

/**
 * Hard tenant/store isolation, enforced server-side — never trust the
 * frontend (spec section 21).
 *
 * Usage: mount on any route with a :storeId param (or resolve storeId from
 * a parent resource first, then call assertStoreAccess manually).
 *
 * If a Cashier that belongs to store A requests /api/stores/B/products,
 * this rejects with 403 even if B is a real store — belonging to *any*
 * tenant, including their own tenant's other branches — unless the user's
 * permissions explicitly include cross-store access (not implemented by
 * default; add a permission like "view_all_branches" if you need it later).
 */
export function requireStoreMatch(paramName: string = "storeId") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.isSuperAdmin) return next(); // Super Admin bypasses (audited separately, see impersonation)

    const requestedStoreId = req.params[paramName];
    if (!req.auth?.storeId || req.auth.storeId !== requestedStoreId) {
      return res.status(403).json({ error: "Forbidden: this resource does not belong to your store" });
    }
    return next();
  };
}

/**
 * Call this inside a controller after loading a resource by ID (e.g. a
 * product, sale, or invoice) to confirm it actually belongs to the caller's
 * tenant/store before returning or mutating it. Prevents IDOR even when the
 * ID itself isn't guessable from a URL pattern a route-level check would
 * catch.
 */
export function assertOwnership(
  req: Request,
  resource: { tenantId?: string | null; storeId?: string | null } | null
): resource is { tenantId: string; storeId: string } {
  if (!resource) return false;
  if (req.auth?.isSuperAdmin) return true;
  if (resource.tenantId !== req.auth?.tenantId) return false;
  if (resource.storeId && resource.storeId !== req.auth?.storeId) return false;
  return true;
}

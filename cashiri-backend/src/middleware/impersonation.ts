import { NextFunction, Request, Response } from "express";

/**
 * Spec section 32: impersonation must show a clear warning it's in effect,
 * be audit-logged (done at token-issue time, see impersonation.controller.ts),
 * and NOT allow deleting sensitive data without an extra permission. Since
 * "an extra permission" isn't something a Super Admin grants themselves
 * mid-impersonation, we simply block the destructive class of actions
 * outright while impersonating — the Super Admin can always act as
 * themselves (their own /api/admin endpoints) for anything that needs it.
 */
export function blockDestructiveWhileImpersonating(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.impersonating) {
    return res.status(403).json({ error: "Destructive actions are disabled while impersonating a store. Switch back to your Super Admin account." });
  }
  return next();
}

import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";

/** Require the caller's flattened permission set to include `code`. */
export function requirePermission(code: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.isSuperAdmin) return next();
    // Product managers can manage the component list of composite products.
    // This also keeps already-issued tokens compatible after BOM permissions
    // are introduced or updated in the role seed.
    if (code.startsWith("bom.") && (req.auth?.permissions?.includes("create_products") || req.auth?.permissions?.includes("edit_products"))) return next();

    if (!req.auth?.userId) return res.status(403).json({ error: `Missing permission: ${code}` });
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { userRoles: { select: { role: { select: { rolePermissions: { select: { permission: { select: { code: true } } } } } } } } },
    });
    const currentPermissions = new Set(user?.userRoles.flatMap((userRole) => userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code)) ?? []);
    if (!currentPermissions.has(code)) {
      return res.status(403).json({ error: `Missing permission: ${code}` });
    }
    return next();
  };
}

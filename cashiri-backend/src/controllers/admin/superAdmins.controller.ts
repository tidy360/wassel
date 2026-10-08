import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

const createSuperAdminSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3).max(50),
  email: z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional()),
  password: z.string().min(4),
});

export async function listSuperAdmins(_req: Request, res: Response) {
  const admins = await prisma.user.findMany({
    where: { isSuperAdmin: true },
    select: { id: true, name: true, username: true, email: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(admins);
}

export async function createSuperAdmin(req: Request, res: Response) {
  const parsed = createSuperAdminSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const existing = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (existing) return res.status(409).json({ error: "A user with this username already exists" });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const admin = await prisma.user.create({
    data: { name: parsed.data.name, username: parsed.data.username, email: parsed.data.email, passwordHash, isSuperAdmin: true, status: "active" },
  });

  await logAudit(req, { action: "super_admin.created", entity: "User", entityId: admin.id, after: { username: admin.username } });
  res.status(201).json({ id: admin.id, name: admin.name, username: admin.username, email: admin.email });
}

export function setSuperAdminStatus(status: "active" | "disabled") {
  return async (req: Request, res: Response) => {
    if (req.params.id === req.auth!.userId && status === "disabled") {
      return res.status(400).json({ error: "You cannot disable your own account" });
    }
    const admin = await prisma.user.findFirst({ where: { id: req.params.id, isSuperAdmin: true } });
    if (!admin) return res.status(404).json({ error: "Super Admin not found" });

    const updated = await prisma.user.update({ where: { id: admin.id }, data: { status } });
    await logAudit(req, { action: status === "disabled" ? "super_admin.disabled" : "super_admin.enabled", entity: "User", entityId: updated.id });
    res.json({ id: updated.id, status: updated.status });
  };
}

// ---------- Platform staff (Accountant / Customer Service — spec section 8) ----------

const PLATFORM_ROLE_NAMES = ["ACCOUNTANT", "CUSTOMER_SERVICE"] as const;

const createPlatformUserSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3).max(50),
  email: z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional()),
  password: z.string().min(4),
  roleName: z.enum(PLATFORM_ROLE_NAMES),
});
const updatePlatformUserSchema = createPlatformUserSchema.extend({ password: z.string().min(4).optional() });

export async function listPlatformUsers(_req: Request, res: Response) {
  const users = await prisma.user.findMany({
    where: { isSuperAdmin: false, tenantId: null, storeId: null },
    include: { userRoles: { include: { role: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(
    users.map((u) => ({
      id: u.id, name: u.name, username: u.username, email: u.email, status: u.status,
      roles: u.userRoles.map((ur) => ur.role.name),
      createdAt: u.createdAt,
    }))
  );
}

/** Super-Admin-only: creates a platform staff account (Accountant or Customer Service). */
export async function createPlatformUser(req: Request, res: Response) {
  const parsed = createPlatformUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const existing = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (existing) return res.status(409).json({ error: "A user with this username already exists" });

  const role = await prisma.role.findFirst({ where: { name: parsed.data.roleName, isSystem: true } });
  if (!role) return res.status(500).json({ error: "Role not found — run the seed script first" });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: parsed.data.name, username: parsed.data.username, email: parsed.data.email, passwordHash, isSuperAdmin: false, status: "active" },
    });
    await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });
    return created;
  });

  await logAudit(req, { action: "platform_user.created", entity: "User", entityId: user.id, after: { username: user.username, role: role.name } });
  res.status(201).json({ id: user.id, name: user.name, username: user.username, email: user.email, role: role.name });
}

export async function updatePlatformUser(req: Request, res: Response) {
  const parsed = updatePlatformUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const existingUser = await prisma.user.findFirst({ where: { id: req.params.id, isSuperAdmin: false, tenantId: null, storeId: null } });
  if (!existingUser) return res.status(404).json({ error: "Platform user not found" });
  const duplicate = await prisma.user.findFirst({ where: { username: parsed.data.username, id: { not: existingUser.id } } });
  if (duplicate) return res.status(409).json({ error: "A user with this username already exists" });
  const role = await prisma.role.findFirst({ where: { name: parsed.data.roleName, isSystem: true } });
  if (!role) return res.status(500).json({ error: "Role not found — run the seed script first" });

  const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 12) : undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: existingUser.id }, data: { name: parsed.data.name, username: parsed.data.username, email: parsed.data.email, ...(passwordHash ? { passwordHash } : {}) } });
    await tx.userRole.deleteMany({ where: { userId: user.id } });
    await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
    return user;
  });
  await logAudit(req, { action: "platform_user.updated", entity: "User", entityId: updated.id, after: { username: updated.username, role: role.name } });
  res.json({ id: updated.id, name: updated.name, username: updated.username, email: updated.email, role: role.name });
}

export function setPlatformUserStatus(status: "active" | "disabled") {
  return async (req: Request, res: Response) => {
    const user = await prisma.user.findFirst({ where: { id: req.params.id, isSuperAdmin: false, tenantId: null, storeId: null } });
    if (!user) return res.status(404).json({ error: "Platform user not found" });

    const updated = await prisma.user.update({ where: { id: user.id }, data: { status } });
    await logAudit(req, { action: status === "disabled" ? "platform_user.disabled" : "platform_user.enabled", entity: "User", entityId: updated.id });
    res.json({ id: updated.id, status: updated.status });
  };
}

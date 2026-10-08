import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { scope } from "../../middleware/storeScope";

export async function listUsers(req: Request, res: Response) {
  const users = await prisma.user.findMany({
    where: scope(req),
    include: { userRoles: { include: { role: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      phone: u.phone,
      email: u.email,
      status: u.status,
      roles: u.userRoles.map((ur) => ur.role.name),
      createdAt: u.createdAt,
    }))
  );
}

const createUserSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  username: z.string().min(3).max(50),
  email: z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional()),
  password: z.string().min(8),
  roleName: z.enum(["ADMIN", "MANAGER", "CASHIER", "STORE_STAFF"]),
});

export async function createUser(req: Request, res: Response) {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const existing = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (existing) return res.status(409).json({ error: "A user with this username already exists" });

  const role = await prisma.role.findFirst({ where: { name: parsed.data.roleName, isSystem: true } });
  if (!role) return res.status(500).json({ error: "Role not found — run the seed script" });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const { tenantId, storeId } = scope(req);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        tenantId,
        storeId,
        name: parsed.data.name,
        username: parsed.data.username,
        phone: parsed.data.phone,
        email: parsed.data.email,
        passwordHash,
        status: "active",
      },
    });
    await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });
    return created;
  });

  await logAudit(req, { action: "user.created", entity: "User", entityId: user.id, after: { id: user.id, username: user.username, role: role.name } });
  res.status(201).json({ id: user.id, name: user.name, username: user.username, email: user.email, role: role.name });
}

export function setUserStatus(status: "active" | "disabled") {
  return async (req: Request, res: Response) => {
    const user = await prisma.user.findFirst({ where: { id: req.params.id, ...scope(req) } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.id === req.auth!.userId && status === "disabled") {
      return res.status(400).json({ error: "You cannot disable your own account" });
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data: { status } });
    await logAudit(req, {
      action: status === "disabled" ? "user.disabled" : "user.enabled",
      entity: "User",
      entityId: updated.id,
      before: { status: user.status },
      after: { status: updated.status },
    });
    res.json({ id: updated.id, status: updated.status });
  };
}

const changeRoleSchema = z.object({ roleName: z.enum(["ADMIN", "MANAGER", "CASHIER", "STORE_STAFF"]) });

export async function changeUserRole(req: Request, res: Response) {
  const parsed = changeRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const user = await prisma.user.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const role = await prisma.role.findFirst({ where: { name: parsed.data.roleName, isSystem: true } });
  if (!role) return res.status(500).json({ error: "Role not found — run the seed script" });

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId: user.id } }),
    prisma.userRole.create({ data: { userId: user.id, roleId: role.id } }),
  ]);

  await logAudit(req, { action: "user.role_changed", entity: "User", entityId: user.id, after: { role: role.name } });
  res.json({ id: user.id, role: role.name });
}

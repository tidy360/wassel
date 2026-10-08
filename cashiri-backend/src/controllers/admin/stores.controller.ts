import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

const createStoreSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  taxNumber: z.string().optional(),
  currency: z.string().default("SDG"),
  // Bootstrap credentials for the store's first ADMIN user, so the tenant
  // has a way to log in immediately. They can add more users themselves
  // once logged in (spec section 20).
  adminUsername: z.string().min(3).max(50),
  adminEmail: z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional()),
  adminName: z.string().min(1),
  adminPassword: z.string().min(8).optional(), // if omitted, a random one is generated and returned once
});

export async function listStoresForTenant(req: Request, res: Response) {
  const stores = await prisma.store.findMany({
    where: { tenantId: req.params.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(stores);
}

export async function listStoreUsers(req: Request, res: Response) {
  const users = await prisma.user.findMany({
    where: { tenantId: req.params.tenantId, storeId: req.params.storeId },
    include: { userRoles: { include: { role: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, roles: u.userRoles.map((ur) => ur.role.name) })));
}

export async function createStore(req: Request, res: Response) {
  const parsed = createStoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { adminUsername, adminEmail, adminName, adminPassword, ...storeData } = parsed.data;

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const subscription = await prisma.subscription.findFirst({
    where: { tenantId: tenant.id, status: "active", endDate: { gte: new Date() } },
    orderBy: { endDate: "desc" },
    include: { plan: { select: { maxBranches: true } } },
  });
  const currentStoreCount = await prisma.store.count({ where: { tenantId: tenant.id } });
  if (subscription?.plan.maxBranches != null && currentStoreCount >= subscription.plan.maxBranches) {
    return res.status(409).json({ error: `تم الوصول إلى الحد الأقصى للفروع في الباقة (${subscription.plan.maxBranches})` });
  }

  const existingUser = await prisma.user.findUnique({ where: { username: adminUsername } });
  if (existingUser) return res.status(409).json({ error: "A user with this email already exists" });

  const adminRole = await prisma.role.findFirst({ where: { name: "ADMIN", isSystem: true } });
  if (!adminRole) {
    return res.status(500).json({ error: "ADMIN system role not found — run the seed script first" });
  }

  const generatedPassword = adminPassword ?? crypto.randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(generatedPassword, 12);

  const result = await prisma.$transaction(async (tx) => {
    const hasExistingStore = await tx.store.count({ where: { tenantId: tenant.id } });
    const store = await tx.store.create({ data: { ...storeData, tenantId: tenant.id, isMain: hasExistingStore === 0 } });
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        name: adminName,
        username: adminUsername,
        email: adminEmail,
        passwordHash,
        status: "active",
        allStoresAccess: hasExistingStore === 0,
      },
    });
    await tx.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
    return { store, user };
  });

  await logAudit(req, {
    action: "store.created",
    entity: "Store",
    entityId: result.store.id,
    after: { store: result.store, adminUserId: result.user.id },
  });

  res.status(201).json({
    store: result.store,
    adminUser: { id: result.user.id, username: result.user.username, email: result.user.email },
    // Only returned once, at creation time — never retrievable again.
    generatedPassword: adminPassword ? undefined : generatedPassword,
  });
}

export function setStoreActive(isActive: boolean) {
  return async (req: Request, res: Response) => {
    const before = await prisma.store.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Store not found" });

    const store = await prisma.store.update({ where: { id: req.params.id }, data: { isActive } });
    await logAudit(req, {
      action: isActive ? "store.activated" : "store.suspended",
      entity: "Store",
      entityId: store.id,
      before,
      after: store,
    });
    res.json(store);
  };
}

export async function deleteStore(req: Request, res: Response) {
  const store = await prisma.store.findUnique({ where: { id: req.params.id } });
  if (!store) return res.status(404).json({ error: "Store not found" });

  const storeCount = await prisma.store.count({ where: { tenantId: store.tenantId } });
  if (storeCount <= 1) return res.status(409).json({ error: "لا يمكن حذف الفرع الوحيد للتاجر" });

  await prisma.store.delete({ where: { id: store.id } });
  await logAudit(req, { action: "store.deleted", entity: "Store", entityId: store.id, before: store });
  res.json({ success: true });
}

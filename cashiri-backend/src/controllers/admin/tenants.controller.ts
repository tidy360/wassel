import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

const createTenantSchema = z.object({
  businessName: z.string().min(1),
  ownerName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  salesRepId: z.string().uuid().nullable().optional(), // spec section 3 — "المندوب الذي أحضر التاجر"
});

export async function listTenants(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const where = status ? { status } : {};

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        stores: { select: { id: true, name: true, isActive: true } },
        salesRep: { select: { id: true, name: true } },
        subscriptions: {
          where: { status: "active", endDate: { gte: new Date() } },
          orderBy: { endDate: "desc" },
          include: { plan: { select: { name: true, maxBranches: true } } },
        },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  res.json({
    data: tenants.map((t) => {
      const currentSubscription = t.subscriptions.find((subscription) => subscription.startDate <= new Date()) ?? t.subscriptions[0];
      const latestSubscription = t.subscriptions[0];
      return {
        id: t.id,
        businessName: t.businessName,
        ownerName: t.ownerName,
        phone: t.phone,
        email: t.email,
        status: t.status,
        createdAt: t.createdAt,
        storeCount: t.stores.length,
        activeStoreCount: t.stores.filter((s) => s.isActive).length,
        currentPlan: currentSubscription?.plan.name ?? null,
        maxBranches: currentSubscription?.plan.maxBranches ?? null,
        subscriptionEndsAt: latestSubscription?.endDate ?? null,
        salesRep: t.salesRep,
      };
    }),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}

export async function getTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    include: {
      stores: true,
      salesRep: true,
      subscriptions: { orderBy: { endDate: "desc" }, include: { plan: true } },
      users: { select: { id: true, name: true, email: true, storeId: true, status: true } },
      paymentPlans: { include: { installments: { orderBy: { installmentNumber: "asc" } } } },
    },
  });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  res.json(tenant);
}

export async function createTenant(req: Request, res: Response) {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const tenant = await prisma.tenant.create({ data: { ...parsed.data, status: "trial" } });
  await logAudit(req, { action: "tenant.created", entity: "Tenant", entityId: tenant.id, after: tenant });
  res.status(201).json(tenant);
}

export async function updateTenant(req: Request, res: Response) {
  const parsed = createTenantSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const before = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Tenant not found" });

  const tenant = await prisma.tenant.update({ where: { id: req.params.id }, data: parsed.data });

  // Spec section 3 wants sales-rep reassignment specifically called out in
  // the activity log, not just buried in a generic "tenant.updated" diff.
  const action = "salesRepId" in parsed.data && parsed.data.salesRepId !== before.salesRepId ? "tenant.sales_rep_changed" : "tenant.updated";
  await logAudit(req, { action, entity: "Tenant", entityId: tenant.id, before, after: tenant });
  res.json(tenant);
}

export async function deleteTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  await prisma.tenant.delete({ where: { id: tenant.id } });
  await logAudit(req, {
    action: "tenant.deleted",
    entity: "Tenant",
    entityId: tenant.id,
    before: tenant,
  });
  res.json({ success: true });
}

export function setTenantStatus(status: "active" | "suspended") {
  return async (req: Request, res: Response) => {
    const before = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Tenant not found" });

    const tenant = await prisma.tenant.update({ where: { id: req.params.id }, data: { status } });

    // Cascade to stores too — a suspended tenant's stores shouldn't stay
    // reachable just because a store row itself says is_active = true.
    if (status === "suspended") {
      await prisma.store.updateMany({ where: { tenantId: tenant.id }, data: { isActive: false } });
    }

    await logAudit(req, {
      action: status === "suspended" ? "tenant.suspended" : "tenant.activated",
      entity: "Tenant",
      entityId: tenant.id,
      before,
      after: tenant,
    });
    res.json(tenant);
  };
}

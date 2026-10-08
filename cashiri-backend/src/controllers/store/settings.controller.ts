import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { scope } from "../../middleware/storeScope";

export async function getMyStore(req: Request, res: Response) {
  const { tenantId } = scope(req);
  const store = await prisma.store.findFirst({ where: { tenantId } });
  if (!store) return res.status(404).json({ error: "Store not found" });
  res.json(store);
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  logoUrl: z.string().url().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  taxNumber: z.string().optional(),
  currency: z.string().optional(),
});

export async function updateMyStore(req: Request, res: Response) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { tenantId } = scope(req);
  const before = await prisma.store.findFirst({ where: { tenantId } });
  if (!before) return res.status(404).json({ error: "Store not found" });

  const store = await prisma.store.update({ where: { id: before.id }, data: parsed.data });
  await logAudit(req, { action: "store.settings_updated", entity: "Store", entityId: store.id, before, after: store });
  res.json(store);
}

// ---------- Taxes ----------

const taxSchema = z.object({
  name: z.string().min(1),
  rate: z.number().min(0).max(100),
  included: z.boolean().default(false),
  isEnabled: z.boolean().default(false),
});

export async function listTaxes(req: Request, res: Response) {
  res.json(await prisma.tax.findMany({ where: scope(req) }));
}

export async function upsertTax(req: Request, res: Response) {
  const parsed = taxSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  if (req.params.id) {
    const existing = await prisma.tax.findFirst({ where: { id: req.params.id, ...scope(req) } });
    if (!existing) return res.status(404).json({ error: "Tax not found" });
    return res.json(await prisma.tax.update({ where: { id: req.params.id }, data: parsed.data }));
  }
  res.status(201).json(await prisma.tax.create({ data: { ...parsed.data, ...scope(req) } }));
}

// ---------- Payment methods ----------

const paymentMethodSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  requiresAttachment: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export async function listPaymentMethods(req: Request, res: Response) {
  const storeScope = scope(req);
  const defaults = [
    { name: "كاش", code: "cash", requiresAttachment: false },
    { name: "تحويل بنكي", code: "transfer", requiresAttachment: true },
  ];

  for (const method of defaults) {
    const existing = await prisma.paymentMethod.findFirst({ where: { ...storeScope, code: method.code } });
    if (!existing) await prisma.paymentMethod.create({ data: { ...method, ...storeScope, isActive: true } });
  }

  res.json(await prisma.paymentMethod.findMany({ where: { ...storeScope, isActive: true }, orderBy: { name: "asc" } }));
}

export async function upsertPaymentMethod(req: Request, res: Response) {
  const parsed = paymentMethodSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  if (req.params.id) {
    const existing = await prisma.paymentMethod.findFirst({ where: { id: req.params.id, ...scope(req) } });
    if (!existing) return res.status(404).json({ error: "Payment method not found" });
    return res.json(await prisma.paymentMethod.update({ where: { id: req.params.id }, data: parsed.data }));
  }
  res.status(201).json(await prisma.paymentMethod.create({ data: { ...parsed.data, ...scope(req) } }));
}

import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { scope } from "../../middleware/storeScope";
import { createProposalIfNeeded, getPricingSettings } from "../../lib/pricing";

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  purchasePrice: z.number().nonnegative().default(0),
  salePrice: z.number().nonnegative().default(0),
  wholesalePrice: z.number().nonnegative().optional(),
  minStock: z.number().nonnegative().default(0),
  currentStock: z.number().default(0),
  supplierId: z.string().uuid().optional(),
  imageUrl: z.string().url().optional(),
  description: z.string().optional(),
  productType: z.enum(["STANDARD", "COMPOSITE", "MANUFACTURED", "SERVICE"]).default("STANDARD"),
  bundleType: z.enum(["VIRTUAL", "STOCKED"]).optional(),
  minimumPrice: z.number().nonnegative().optional(),
  taxId: z.string().uuid().optional(),
  expiryDate: z.string().date().optional(),
});

export async function listProducts(req: Request, res: Response) {
  const { search, categoryId, lowStock, supplierId } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Number(req.query.pageSize) || 30);

  const where: any = { ...scope(req), isActive: true };
  if (typeof search === "string" && search.trim()) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search, mode: "insensitive" } },
    ];
  }
  if (typeof categoryId === "string") where.categoryId = categoryId;
  if (typeof supplierId === "string") where.supplierId = supplierId;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
    }),
    prisma.product.count({ where }),
  ]);

  const filtered = lowStock === "true" ? products.filter((p) => Number(p.currentStock) <= Number(p.minStock)) : products;

  res.json({ data: filtered, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}

export async function getProductByBarcode(req: Request, res: Response) {
  const product = await prisma.product.findFirst({ where: { barcode: req.params.barcode, ...scope(req), isActive: true } });
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
}

export async function getProduct(req: Request, res: Response) {
  const product = await prisma.product.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
}

export async function createProduct(req: Request, res: Response) {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { expiryDate, ...rest } = parsed.data;
  if (rest.barcode) {
    const duplicate = await prisma.product.findFirst({ where: { ...scope(req), barcode: rest.barcode, isActive: true } });
    if (duplicate) return res.status(409).json({ error: "يوجد منتج آخر بهذا الباركود" });
  }
  const product = await prisma.product.create({
    data: {
      ...rest,
      ...scope(req),
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      createdBy: req.auth!.userId,
    },
  });
  const settings = await getPricingSettings(req.auth!.tenantId!, req.auth!.storeId!);
  await prisma.productPricing.create({
    data: {
      tenantId: req.auth!.tenantId!, storeId: req.auth!.storeId!, productId: product.id,
      pricingMode: settings.defaultPricingMode, costMethod: settings.defaultCostMethod,
      profitMargin: settings.defaultProfitMargin, minimumProfitMargin: settings.minimumProfitMargin,
      currency: settings.defaultCurrency,
    },
  });
  await logAudit(req, { action: "product.created", entity: "Product", entityId: product.id, after: product });
  res.status(201).json(product);
}

export async function updateProduct(req: Request, res: Response) {
  const parsed = productSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const before = await prisma.product.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!before) return res.status(404).json({ error: "Product not found" });
  if (parsed.data.salePrice !== undefined && !req.auth?.isSuperAdmin && !req.auth?.permissions?.includes("pricing.update")) {
    return res.status(403).json({ error: "Missing permission: pricing.update" });
  }

  const { expiryDate, ...rest } = parsed.data;
  if (rest.barcode) {
    const duplicate = await prisma.product.findFirst({ where: { ...scope(req), barcode: rest.barcode, isActive: true, id: { not: before.id } } });
    if (duplicate) return res.status(409).json({ error: "يوجد منتج آخر بهذا الباركود" });
  }
  const product = await prisma.product.update({
    where: { id: before.id },
    data: { ...rest, expiryDate: expiryDate ? new Date(expiryDate) : undefined },
  });
  if (parsed.data.salePrice !== undefined && !new Prisma.Decimal(parsed.data.salePrice).eq(before.salePrice)) {
    await prisma.priceHistory.create({ data: { tenantId: before.tenantId, storeId: before.storeId, productId: before.id, oldPrice: before.salePrice, newPrice: product.salePrice, cost: product.purchasePrice, changeType: "MANUAL", reason: "MANUAL", userId: req.auth!.userId } });
    await logAudit(req, { action: "PRICE_UPDATED", entity: "Product", entityId: product.id, before: { salePrice: before.salePrice }, after: { salePrice: product.salePrice } });
  }
  if (parsed.data.purchasePrice !== undefined) await createProposalIfNeeded(product, before.tenantId, before.storeId, "COST_CHANGE");
  await logAudit(req, { action: "product.updated", entity: "Product", entityId: product.id, before, after: product });
  res.json(product);
}

export async function deactivateProduct(req: Request, res: Response) {
  const before = await prisma.product.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!before) return res.status(404).json({ error: "Product not found" });
  const product = await prisma.product.update({ where: { id: before.id }, data: { isActive: false } });
  await logAudit(req, { action: "product.deactivated", entity: "Product", entityId: product.id, before });
  res.json(product);
}

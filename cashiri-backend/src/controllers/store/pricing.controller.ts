import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";
import { logAudit } from "../../lib/audit";
import { approveProposal, calculateProductSuggestion, createProposalIfNeeded, COST_METHODS, PRICING_MODES, getPricingSettings } from "../../lib/pricing";

const settingsSchema = z.object({
  defaultPricingMode: z.enum(PRICING_MODES).optional(),
  defaultProfitMargin: z.coerce.number().min(0).max(1000).optional(),
  minimumProfitMargin: z.coerce.number().min(0).max(1000).optional(),
  defaultCostMethod: z.enum(COST_METHODS).optional(),
  defaultCurrency: z.enum(["SDG", "USD", "SAR", "EUR"]).optional(),
  roundingUnit: z.coerce.number().positive().optional(),
  maximumSuggestedIncrease: z.coerce.number().min(0).max(10000).optional(),
  minimumPriceChangeThreshold: z.coerce.number().min(0).max(100).optional(),
  allowSellingBelowCost: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
});

const pricingSchema = z.object({
  pricingMode: z.enum(PRICING_MODES).optional(),
  costMethod: z.enum(COST_METHODS).optional(),
  profitMargin: z.number().min(0).max(1000).optional(),
  minimumProfitMargin: z.number().min(0).max(1000).optional(),
  currency: z.enum(["SDG", "USD", "SAR", "EUR"]).optional(),
});

const exchangeRateSchema = z.object({
  currency: z.enum(["SDG", "USD", "SAR", "EUR"]),
  rate: z.number().positive(),
  effectiveAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

function serialize(value: any) {
  return JSON.parse(JSON.stringify(value, (_key, current) => current instanceof Prisma.Decimal ? Number(current) : current));
}

export async function getPricingSettingsHandler(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  res.json(serialize(await getPricingSettings(tenantId, storeId)));
}

export async function updatePricingSettings(req: Request, res: Response) {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid pricing settings", details: parsed.error.flatten() });
  const { tenantId, storeId } = scope(req);
  const before = await getPricingSettings(tenantId, storeId);
  const settings = await prisma.pricingSettings.update({ where: { storeId }, data: parsed.data });
  await logAudit(req, { action: "MARGIN_UPDATED", entity: "PricingSettings", entityId: settings.id, before, after: settings });
  res.json(serialize(settings));
}

export async function listExchangeRates(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const currency = typeof req.query.currency === "string" ? req.query.currency : undefined;
  res.json(await prisma.exchangeRate.findMany({ where: { tenantId, storeId, ...(currency ? { currency } : {}) }, orderBy: { effectiveAt: "desc" }, take: 200 }));
}

export async function createExchangeRate(req: Request, res: Response) {
  const parsed = exchangeRateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid exchange rate", details: parsed.error.flatten() });
  const { tenantId, storeId } = scope(req);
  const rate = await prisma.exchangeRate.create({ data: { ...parsed.data, tenantId, storeId, effectiveAt: parsed.data.effectiveAt ? new Date(parsed.data.effectiveAt) : new Date(), createdBy: req.auth!.userId } });
  const products = await prisma.product.findMany({ where: { tenantId, storeId, isActive: true }, include: { pricing: true } });
  let proposals = 0;
  for (const product of products) {
    if (product.pricing?.currency === rate.currency && product.pricing.pricingMode !== "MANUAL") {
      if (await createProposalIfNeeded(product, tenantId, storeId, "EXCHANGE_RATE", rate.notes ?? `تغير سعر صرف ${rate.currency}`)) proposals++;
    }
  }
  await logAudit(req, { action: "EXCHANGE_RATE_UPDATED", entity: "ExchangeRate", entityId: rate.id, after: { rate, proposals } });
  res.status(201).json({ rate, proposals });
}

export async function updateExchangeRate(req: Request, res: Response) {
  const parsed = exchangeRateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid exchange rate", details: parsed.error.flatten() });
  const { tenantId, storeId } = scope(req);
  const before = await prisma.exchangeRate.findFirst({ where: { id: req.params.id, tenantId, storeId } });
  if (!before) return res.status(404).json({ error: "Exchange rate not found" });
  const rate = await prisma.exchangeRate.update({ where: { id: before.id }, data: { ...parsed.data, effectiveAt: parsed.data.effectiveAt ? new Date(parsed.data.effectiveAt) : undefined } });
  await logAudit(req, { action: "EXCHANGE_RATE_UPDATED", entity: "ExchangeRate", entityId: rate.id, before, after: rate });
  res.json(rate);
}

async function getScopedProduct(id: string, req: Request) {
  const { tenantId, storeId } = scope(req);
  return prisma.product.findFirst({ where: { id, tenantId, storeId, isActive: true }, include: { pricing: true } });
}

export async function listPricingProducts(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const products = await prisma.product.findMany({ where: { tenantId, storeId, isActive: true }, include: { pricing: true }, orderBy: { name: "asc" }, take: Math.min(500, Number(req.query.pageSize) || 100) });
  const proposals = await prisma.priceChangeProposal.findMany({ where: { tenantId, storeId, status: "PENDING" } });
  const proposalMap = new Map(proposals.map((proposal) => [proposal.productId, proposal]));
  const data = products.map((product) => {
    const proposal = proposalMap.get(product.id);
    const cost = Number(product.pricing?.currentCost ?? product.purchasePrice);
    const price = Number(product.salePrice);
    const margin = cost > 0 ? ((price - cost) / cost) * 100 : 0;
    const minimumMargin = Number(product.pricing?.minimumProfitMargin ?? 0);
    const item = { ...product, currentCost: cost, currentMargin: margin, pendingProposal: proposal ?? null, priceStatus: price < cost ? "BELOW_COST" : proposal ? "PENDING_APPROVAL" : margin < minimumMargin ? "BELOW_MINIMUM_MARGIN" : "UP_TO_DATE" };
    return item;
  }).filter((item) => !status || item.priceStatus === status);
  res.json(serialize({ data }));
}

export async function getPricingProduct(req: Request, res: Response) {
  const product = await getScopedProduct(req.params.id, req);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const { tenantId, storeId } = scope(req);
  const calculation = await calculateProductSuggestion(product, tenantId, storeId);
  const pendingProposal = await prisma.priceChangeProposal.findFirst({ where: { productId: product.id, tenantId, storeId, status: "PENDING" } });
  res.json(serialize({ product, calculation, pendingProposal }));
}

export async function updateProductPricing(req: Request, res: Response) {
  const parsed = pricingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product pricing", details: parsed.error.flatten() });
  const product = await getScopedProduct(req.params.id, req);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const { tenantId, storeId } = scope(req);
  const settings = await getPricingSettings(tenantId, storeId);
  const pricing = await prisma.productPricing.upsert({ where: { productId: product.id }, update: parsed.data, create: { tenantId, storeId, productId: product.id, pricingMode: settings.defaultPricingMode, costMethod: settings.defaultCostMethod, profitMargin: settings.defaultProfitMargin, minimumProfitMargin: settings.minimumProfitMargin, currency: settings.defaultCurrency, ...parsed.data } });
  await createProposalIfNeeded(product, tenantId, storeId, "MARGIN_UPDATED");
  await logAudit(req, { action: "MARGIN_UPDATED", entity: "ProductPricing", entityId: pricing.id, after: pricing });
  res.json(serialize(pricing));
}

export async function recalculateProduct(req: Request, res: Response) {
  const product = await getScopedProduct(req.params.id, req);
  if (!product) return res.status(404).json({ error: "Product not found" });
  const { tenantId, storeId } = scope(req);
  const proposal = await createProposalIfNeeded(product, tenantId, storeId, typeof req.body?.reason === "string" ? req.body.reason : "COST_CHANGE", req.body?.note);
  const calculation = await calculateProductSuggestion(product, tenantId, storeId);
  if (proposal) await logAudit(req, { action: "SUGGESTED_PRICE_CREATED", entity: "PriceChangeProposal", entityId: proposal.id, after: proposal });
  res.json(serialize({ calculation, proposal }));
}

export async function approveProductPrice(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const updated = await approveProposal(req.params.id, tenantId, storeId, req.auth!.userId);
  if (!updated) return res.status(404).json({ error: "Pending price proposal not found" });
  await logAudit(req, { action: "PRICE_APPROVED", entity: "Product", entityId: updated.id, after: updated });
  res.json(serialize(updated));
}

export async function rejectProductPrice(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const proposal = await prisma.priceChangeProposal.findFirst({ where: { id: req.params.id, tenantId, storeId, status: "PENDING" } });
  if (!proposal) return res.status(404).json({ error: "Pending price proposal not found" });
  const updated = await prisma.priceChangeProposal.update({ where: { id: proposal.id }, data: { status: "REJECTED", reviewedBy: req.auth!.userId, reviewedAt: new Date(), note: typeof req.body?.note === "string" ? req.body.note : proposal.note } });
  await logAudit(req, { action: "PRICE_REJECTED", entity: "PriceChangeProposal", entityId: updated.id, before: proposal, after: updated });
  res.json(serialize(updated));
}

export async function bulkPreview(req: Request, res: Response) {
  const schema = z.object({ productIds: z.array(z.string().uuid()).optional(), operation: z.enum(["INCREASE_PERCENT", "DECREASE_PERCENT", "SET_MARGIN", "FROM_COST", "FROM_EXCHANGE_RATE"]), value: z.number().optional(), reason: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid bulk update", details: parsed.error.flatten() });
  const { tenantId, storeId } = scope(req);
  const products = await prisma.product.findMany({ where: { tenantId, storeId, isActive: true, ...(parsed.data.productIds?.length ? { id: { in: parsed.data.productIds } } : {}) }, include: { pricing: true } });
  const settings = await getPricingSettings(tenantId, storeId);
  const preview = [];
  for (const product of products) {
    const calc = await calculateProductSuggestion(product, tenantId, storeId);
    let suggested = calc.suggestedPrice ?? calc.currentPrice;
    if (parsed.data.operation === "INCREASE_PERCENT" && parsed.data.value != null) suggested = calc.currentPrice.mul(new Prisma.Decimal(1).add(new Prisma.Decimal(parsed.data.value).div(100)));
    if (parsed.data.operation === "DECREASE_PERCENT" && parsed.data.value != null) suggested = calc.currentPrice.mul(new Prisma.Decimal(1).sub(new Prisma.Decimal(parsed.data.value).div(100)));
    if (parsed.data.operation === "SET_MARGIN" && parsed.data.value != null) suggested = calc.cost.mul(new Prisma.Decimal(1).add(new Prisma.Decimal(parsed.data.value).div(100)));
    suggested = suggested.div(settings.roundingUnit).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(settings.roundingUnit);
    preview.push({ productId: product.id, productName: product.name, currentPrice: calc.currentPrice, currentCost: calc.cost, suggestedPrice: suggested, difference: suggested.sub(calc.currentPrice), reason: parsed.data.reason ?? parsed.data.operation });
  }
  res.json(serialize({ data: preview }));
}

export async function bulkApprove(req: Request, res: Response) {
  const schema = z.object({ changes: z.array(z.object({ productId: z.string().uuid(), newPrice: z.number().nonnegative(), reason: z.string().min(1), note: z.string().optional() })).min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid price changes", details: parsed.error.flatten() });
  const { tenantId, storeId } = scope(req);
  const results = [];
  for (const change of parsed.data.changes) {
    const product = await prisma.product.findFirst({ where: { id: change.productId, tenantId, storeId, isActive: true } });
    if (!product) continue;
    const newPrice = new Prisma.Decimal(change.newPrice);
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { salePrice: newPrice } });
      await tx.priceHistory.create({ data: { tenantId, storeId, productId: product.id, oldPrice: product.salePrice, newPrice, cost: product.purchasePrice, changeType: "BULK_PRICE_UPDATE", reason: change.reason, note: change.note, userId: req.auth!.userId } });
    });
    results.push(product.id);
  }
  await logAudit(req, { action: "BULK_PRICE_UPDATE", entity: "Product", after: { productIds: results } });
  res.json({ updated: results.length, productIds: results });
}

export async function listPriceChanges(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const status = typeof req.query.status === "string" ? req.query.status : "PENDING";
  res.json(serialize(await prisma.priceChangeProposal.findMany({ where: { tenantId, storeId, status }, include: { product: { select: { name: true, salePrice: true } } }, orderBy: { createdAt: "desc" }, take: 500 })));
}

export async function listPriceHistory(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  res.json(serialize(await prisma.priceHistory.findMany({ where: { tenantId, storeId, productId: req.params.productId }, orderBy: { createdAt: "desc" }, take: 500 })));
}

export async function listPricingAlerts(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const products = await prisma.product.findMany({ where: { tenantId, storeId, isActive: true }, include: { pricing: true } });
  const pending = await prisma.priceChangeProposal.count({ where: { tenantId, storeId, status: "PENDING" } });
  const belowCost = products.filter((p) => Number(p.salePrice) < Number(p.pricing?.currentCost ?? p.purchasePrice)).length;
  res.json({ pendingApproval: pending, belowCost, productCount: products.length });
}

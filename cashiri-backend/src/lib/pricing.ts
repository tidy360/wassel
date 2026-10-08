import { Prisma, Product } from "@prisma/client";
import { prisma } from "./prisma";

export const PRICING_MODES = ["MANUAL", "COST_PLUS", "DYNAMIC"] as const;
export const COST_METHODS = ["LAST_PURCHASE_COST", "AVERAGE_COST", "WEIGHTED_AVERAGE_COST"] as const;

export async function getPricingSettings(tenantId: string, storeId: string, client = prisma) {
  return client.pricingSettings.upsert({
    where: { storeId },
    update: {},
    create: { tenantId, storeId },
  });
}

async function getCost(product: Product, method: string, tenantId: string, storeId: string, client = prisma) {
  if (method === "LAST_PURCHASE_COST") return new Prisma.Decimal(product.purchasePrice);

  const items = await client.purchaseItem.findMany({
    where: { productId: product.id, purchase: { tenantId, storeId } },
    select: { quantity: true, unitPrice: true },
  });
  if (!items.length) return new Prisma.Decimal(product.purchasePrice);

  const quantity = items.reduce((sum, item) => sum.add(item.quantity), new Prisma.Decimal(0));
  const value = items.reduce((sum, item) => sum.add(item.quantity.mul(item.unitPrice)), new Prisma.Decimal(0));
  if (quantity.isZero()) return new Prisma.Decimal(product.purchasePrice);
  return method === "AVERAGE_COST" ? value.div(items.length) : value.div(quantity);
}

function roundPrice(value: Prisma.Decimal, unit: Prisma.Decimal) {
  if (unit.lte(0) || unit.eq(1)) return value.toDecimalPlaces(2);
  return value.div(unit).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(unit).toDecimalPlaces(2);
}

export async function calculateProductSuggestion(product: Product, tenantId: string, storeId: string, client = prisma) {
  const settings = await getPricingSettings(tenantId, storeId, client);
  const pricing = await client.productPricing.upsert({
    where: { productId: product.id },
    update: {},
    create: {
      tenantId,
      storeId,
      productId: product.id,
      pricingMode: settings.defaultPricingMode,
      costMethod: settings.defaultCostMethod,
      profitMargin: settings.defaultProfitMargin,
      minimumProfitMargin: settings.minimumProfitMargin,
      currency: settings.defaultCurrency,
    },
  });

  const cost = await getCost(product, pricing.costMethod, tenantId, storeId, client);
  let localCost = cost;
  let exchangeRate: Prisma.Decimal | null = null;
  if (pricing.currency !== settings.defaultCurrency) {
    const rate = await client.exchangeRate.findFirst({
      where: { tenantId, storeId, currency: pricing.currency, isActive: true },
      orderBy: { effectiveAt: "desc" },
    });
    if (rate) {
      exchangeRate = rate.rate;
      localCost = cost.mul(rate.rate);
    }
  }

  const suggestedPrice = pricing.pricingMode === "MANUAL"
    ? null
    : roundPrice(localCost.mul(new Prisma.Decimal(1).add(pricing.profitMargin.div(100))), settings.roundingUnit);
  const currentPrice = new Prisma.Decimal(product.salePrice);
  const differencePercent = suggestedPrice && !currentPrice.isZero()
    ? suggestedPrice.sub(currentPrice).div(currentPrice).mul(100)
    : new Prisma.Decimal(0);

  return { settings, pricing, cost: localCost, exchangeRate, suggestedPrice, currentPrice, differencePercent };
}

export async function createProposalIfNeeded(product: Product, tenantId: string, storeId: string, reason: string, note?: string, client = prisma) {
  const result = await calculateProductSuggestion(product, tenantId, storeId, client);
  if (!result.suggestedPrice) return null;
  if (result.differencePercent.abs().lt(result.settings.minimumPriceChangeThreshold)) return null;
  if (result.suggestedPrice.eq(result.currentPrice)) return null;
  const exceedsIncreaseLimit = result.differencePercent.gt(result.settings.maximumSuggestedIncrease);
  const proposalReason = exceedsIncreaseLimit ? `${reason}_EXCEEDS_LIMIT` : reason;

  const existing = await client.priceChangeProposal.findFirst({
    where: { tenantId, storeId, productId: product.id, status: "PENDING", suggestedPrice: result.suggestedPrice },
  });
  if (existing) return existing;

  await client.productPricing.update({
    where: { productId: product.id },
    data: {
      currentCost: result.cost,
      lastCost: product.purchasePrice,
      suggestedPrice: result.suggestedPrice,
      suggestionReason: proposalReason,
      lastPriceUpdate: new Date(),
    },
  });

  return client.priceChangeProposal.create({
    data: {
      tenantId,
      storeId,
      productId: product.id,
      oldPrice: result.currentPrice,
      suggestedPrice: result.suggestedPrice,
      currentCost: result.cost,
      profitMargin: result.pricing.profitMargin,
      reason: proposalReason,
      note,
    },
  });
}

export async function approveProposal(proposalId: string, tenantId: string, storeId: string, userId: string, client = prisma) {
  const proposal = await client.priceChangeProposal.findFirst({ where: { id: proposalId, tenantId, storeId, status: "PENDING" } });
  if (!proposal) return null;
  const product = await client.product.findFirst({ where: { id: proposal.productId, tenantId, storeId, isActive: true } });
  if (!product) return null;

  const updated = await client.$transaction(async (tx) => {
    const changed = await tx.product.update({ where: { id: product.id }, data: { salePrice: proposal.suggestedPrice } });
    await tx.priceChangeProposal.update({ where: { id: proposal.id }, data: { status: "APPROVED", reviewedBy: userId, reviewedAt: new Date() } });
    await tx.priceHistory.create({
      data: {
        tenantId,
        storeId,
        productId: product.id,
        oldPrice: product.salePrice,
        newPrice: proposal.suggestedPrice,
        cost: proposal.currentCost,
        profitMargin: proposal.profitMargin,
        changeType: "PRICE_APPROVED",
        reason: proposal.reason,
        note: proposal.note,
        userId,
      },
    });
    return changed;
  });
  return updated;
}

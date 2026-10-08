import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { scope } from "../../middleware/storeScope";

const bomItemSchema = z.object({
  componentProductId: z.string().uuid(),
  quantity: z.number().positive(),
  unitId: z.string().uuid().optional(),
  wastePercent: z.number().min(0).max(100).default(0),
  isOptional: z.boolean().default(false),
  notes: z.string().max(500).optional(),
});

const bomSchema = z.object({
  productId: z.string().uuid(),
  status: z.enum(["draft", "active"]).default("active"),
  notes: z.string().max(1000).optional(),
  items: z.array(bomItemSchema).min(1),
});

const manufacturingOrderSchema = z.object({
  productId: z.string().uuid(),
  bomVersionId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  plannedQuantity: z.number().positive(),
  plannedDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

const quantitySchema = z.object({ quantity: z.number().positive().optional() });

function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

async function assertProductInScope(productId: string, tenantId: string, storeId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId, storeId, isActive: true } });
  if (!product) throw badRequest("Product not found in this store");
  return product;
}

async function hasBomCycle(productId: string, componentIds: string[], tenantId: string, storeId: string, visited = new Set<string>()) {
  if (componentIds.includes(productId)) return true;
  if (visited.has(productId)) return false;
  visited.add(productId);

  const versions = await prisma.bomVersion.findMany({
    where: { productId, tenantId, storeId, status: "active" },
    include: { items: { select: { componentProductId: true } } },
  });
  for (const version of versions) {
    for (const item of version.items) {
      if (await hasBomCycle(item.componentProductId, componentIds, tenantId, storeId, visited)) return true;
    }
  }
  return false;
}

export async function getProductBom(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const product = await assertProductInScope(req.params.productId, tenantId, storeId);
  const bom = await prisma.bomVersion.findFirst({
    where: { productId: product.id, tenantId, storeId, status: "active" },
    orderBy: { version: "desc" },
    include: { items: { include: { componentProduct: true }, orderBy: { id: "asc" } } },
  });
  res.json(bom ?? { productId: product.id, items: [] });
}

export async function createProductBom(req: Request, res: Response) {
  const parsed = bomSchema.safeParse({ ...req.body, productId: req.params.productId });
  if (!parsed.success) return res.status(400).json({ error: "Invalid BOM", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  try {
    const product = await assertProductInScope(parsed.data.productId, tenantId, storeId);
    if (!["COMPOSITE", "MANUFACTURED"].includes(product.productType)) throw badRequest("BOM is only supported for composite or manufactured products");

    const componentIds = parsed.data.items.map((item) => item.componentProductId);
    if (new Set(componentIds).size !== componentIds.length) throw badRequest("A component can only appear once in a BOM");
    if (await hasBomCycle(product.id, componentIds, tenantId, storeId)) throw badRequest("Circular BOM reference is not allowed");

    const components = await prisma.product.findMany({ where: { id: { in: componentIds }, tenantId, storeId, isActive: true } });
    if (components.length !== componentIds.length) throw badRequest("One or more BOM components are not in this store");

    const latest = await prisma.bomVersion.findFirst({ where: { productId: product.id, tenantId, storeId }, orderBy: { version: "desc" } });
    const bom = await prisma.$transaction(async (tx) => {
      if (parsed.data.status === "active") {
        await tx.bomVersion.updateMany({ where: { productId: product.id, tenantId, storeId, status: "active" }, data: { status: "archived" } });
      }
      return tx.bomVersion.create({
        data: {
          tenantId, storeId, productId: product.id, version: (latest?.version ?? 0) + 1,
          status: parsed.data.status, notes: parsed.data.notes, createdBy: req.auth!.userId,
          items: { create: parsed.data.items },
        },
        include: { items: true },
      });
    });
    await logAudit(req, { action: "bom.created", entity: "BomVersion", entityId: bom.id, after: bom });
    res.status(201).json(bom);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Failed to create BOM" });
  }
}

export async function listManufacturingOrders(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const orders = await prisma.manufacturingOrder.findMany({
    where: { tenantId, storeId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" }, take: 100,
    include: { product: true, bomVersion: true, items: { include: { componentProduct: true } } },
  });
  res.json(orders);
}

export async function getManufacturingOrder(req: Request, res: Response) {
  const order = await prisma.manufacturingOrder.findFirst({
    where: { id: req.params.id, ...scope(req) },
    include: { product: true, bomVersion: true, items: { include: { componentProduct: true } }, reservations: true, consumptions: true, costs: true },
  });
  if (!order) return res.status(404).json({ error: "Manufacturing order not found" });
  res.json(order);
}

export async function createManufacturingOrder(req: Request, res: Response) {
  const parsed = manufacturingOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid manufacturing order", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  try {
    const input = parsed.data;
    if (input.idempotencyKey) {
      const existing = await prisma.manufacturingOrder.findFirst({ where: { storeId, idempotencyKey: input.idempotencyKey } });
      if (existing) return res.status(200).json(existing);
    }
    const product = await assertProductInScope(input.productId, tenantId, storeId);
    if (!["COMPOSITE", "MANUFACTURED"].includes(product.productType)) throw badRequest("Only composite or manufactured products can be manufactured");

    const bom = await prisma.bomVersion.findFirst({
      where: { id: input.bomVersionId, productId: product.id, tenantId, storeId, status: "active" },
      orderBy: { version: "desc" }, include: { items: { include: { componentProduct: true } } },
    });
    if (!bom) throw badRequest("An active BOM is required");

    const order = await prisma.$transaction(async (tx) => {
      const last = await tx.manufacturingOrder.findFirst({ where: { tenantId, storeId }, orderBy: { orderNumber: "desc" } });
      const items = bom.items.map((item) => {
        const required = new Prisma.Decimal(input.plannedQuantity).mul(item.quantity);
        const waste = required.mul(item.wastePercent).div(100);
        return { componentProductId: item.componentProductId, requiredQuantity: required.add(waste), unitCost: item.componentProduct.purchasePrice, wasteQuantity: waste };
      });
      return tx.manufacturingOrder.create({
        data: {
          tenantId, storeId, branchId: input.branchId, warehouseId: input.warehouseId,
          orderNumber: (last?.orderNumber ?? 0) + 1, productId: product.id, bomVersionId: bom.id,
          idempotencyKey: input.idempotencyKey, plannedQuantity: input.plannedQuantity,
          plannedDate: input.plannedDate ? new Date(input.plannedDate) : undefined, notes: input.notes, createdBy: req.auth!.userId,
          items: { create: items },
        },
        include: { items: true, product: true, bomVersion: true },
      });
    });
    await logAudit(req, { action: "manufacturing.created", entity: "ManufacturingOrder", entityId: order.id, after: order });
    res.status(201).json(order);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Failed to create manufacturing order" });
  }
}

export async function reserveManufacturingOrder(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  try {
    const order = await prisma.manufacturingOrder.findFirst({ where: { id: req.params.id, tenantId, storeId }, include: { items: true } });
    if (!order) return res.status(404).json({ error: "Manufacturing order not found" });
    if (["COMPLETED", "CANCELLED"].includes(order.status)) throw badRequest("This order cannot be reserved");

    const reservations = await prisma.$transaction(async (tx) => {
      const result = [];
      for (const item of order.items) {
        const existing = await tx.stockReservation.findUnique({ where: { manufacturingOrderId_productId: { manufacturingOrderId: order.id, productId: item.componentProductId } } });
        if (existing) { result.push(existing); continue; }
        const product = await tx.product.findFirst({ where: { id: item.componentProductId, tenantId, storeId, isActive: true } });
        if (!product) throw badRequest("A BOM component is not in this store");
        const reserved = await tx.stockReservation.aggregate({ where: { tenantId, storeId, productId: product.id, status: "reserved" }, _sum: { quantity: true } });
        const available = product.currentStock.sub(reserved._sum.quantity ?? 0);
        if (available.lt(item.requiredQuantity)) throw Object.assign(new Error(`Insufficient available stock for ${product.name}`), { status: 409 });
        result.push(await tx.stockReservation.create({ data: { tenantId, storeId, branchId: order.branchId, warehouseId: order.warehouseId, manufacturingOrderId: order.id, productId: product.id, quantity: item.requiredQuantity } }));
      }
      await tx.manufacturingOrder.update({ where: { id: order.id }, data: { status: "PLANNED" } });
      return result;
    });
    await logAudit(req, { action: "manufacturing.reserved", entity: "ManufacturingOrder", entityId: order.id, after: { reservations } });
    res.json({ orderId: order.id, reservations });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Failed to reserve components" });
  }
}

export async function completeManufacturingOrder(req: Request, res: Response) {
  const parsed = quantitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid completion quantity" });
  const { tenantId, storeId } = scope(req);

  try {
    const order = await prisma.manufacturingOrder.findFirst({ where: { id: req.params.id, tenantId, storeId }, include: { items: true } });
    if (!order) return res.status(404).json({ error: "Manufacturing order not found" });
    if (["COMPLETED", "CANCELLED"].includes(order.status)) throw badRequest("This order cannot be completed");
    const quantity = new Prisma.Decimal(parsed.data.quantity ?? Number(order.plannedQuantity) - Number(order.completedQuantity));
    const remaining = order.plannedQuantity.sub(order.completedQuantity);
    if (quantity.gt(remaining)) throw badRequest("Completion quantity exceeds the remaining quantity");

    const completed = await prisma.$transaction(async (tx) => {
      let totalCost = new Prisma.Decimal(0);
      for (const item of order.items) {
        const required = item.requiredQuantity.mul(quantity).div(order.plannedQuantity);
        const product = await tx.product.findFirst({ where: { id: item.componentProductId, tenantId, storeId, isActive: true } });
        if (!product) throw badRequest("A BOM component is not in this store");
        const newStock = product.currentStock.sub(required);
        if (newStock.lt(0)) throw Object.assign(new Error(`Insufficient stock for ${product.name}`), { status: 409 });
        await tx.product.update({ where: { id: product.id }, data: { currentStock: newStock } });
        await tx.inventoryMovement.create({ data: { tenantId, storeId, productId: product.id, movementType: "manufacturing_consumption", quantity: required.neg(), qtyBefore: product.currentStock, qtyAfter: newStock, referenceId: order.id, createdBy: req.auth!.userId } });
        await tx.manufacturingConsumption.create({ data: { tenantId, storeId, manufacturingOrderId: order.id, productId: product.id, quantity: required, wasteQuantity: item.wasteQuantity.mul(quantity).div(order.plannedQuantity), createdBy: req.auth!.userId } });
        await tx.manufacturingOrderItem.update({ where: { id: item.id }, data: { consumedQuantity: { increment: required } } });
        totalCost = totalCost.add(required.mul(product.purchasePrice));
        await tx.stockReservation.updateMany({ where: { manufacturingOrderId: order.id, productId: product.id, status: "reserved" }, data: { status: "consumed", releasedQuantity: { increment: required } } });
      }
      const output = await tx.product.findFirst({ where: { id: order.productId, tenantId, storeId, isActive: true } });
      if (!output) throw badRequest("Manufactured product is not in this store");
      const newOutputStock = output.currentStock.add(quantity);
      await tx.product.update({ where: { id: output.id }, data: { currentStock: newOutputStock, purchasePrice: totalCost.div(quantity) } });
      await tx.inventoryMovement.create({ data: { tenantId, storeId, productId: output.id, movementType: "manufacturing_output", quantity, qtyBefore: output.currentStock, qtyAfter: newOutputStock, referenceId: order.id, createdBy: req.auth!.userId } });
      await tx.productionCost.create({ data: { tenantId, storeId, manufacturingOrderId: order.id, productId: output.id, quantity, unitCost: totalCost.div(quantity), totalCost } });
      const completedQuantity = order.completedQuantity.add(quantity);
      return tx.manufacturingOrder.update({ where: { id: order.id }, data: { completedQuantity, totalCost: { increment: totalCost }, status: completedQuantity.gte(order.plannedQuantity) ? "COMPLETED" : "PARTIALLY_COMPLETED" }, include: { items: true, costs: true } });
    });
    await logAudit(req, { action: "manufacturing.completed", entity: "ManufacturingOrder", entityId: order.id, after: completed });
    res.json(completed);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Failed to complete manufacturing order" });
  }
}

export async function cancelManufacturingOrder(req: Request, res: Response) {
  const { tenantId, storeId } = scope(req);
  const order = await prisma.manufacturingOrder.findFirst({ where: { id: req.params.id, tenantId, storeId } });
  if (!order) return res.status(404).json({ error: "Manufacturing order not found" });
  if (order.completedQuantity.gt(0)) return res.status(409).json({ error: "Completed manufacturing requires reverse manufacturing" });
  const cancelled = await prisma.manufacturingOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
  await prisma.stockReservation.updateMany({ where: { manufacturingOrderId: order.id, status: "reserved" }, data: { status: "cancelled" } });
  await logAudit(req, { action: "manufacturing.cancelled", entity: "ManufacturingOrder", entityId: order.id, before: order, after: cancelled });
  res.json(cancelled);
}

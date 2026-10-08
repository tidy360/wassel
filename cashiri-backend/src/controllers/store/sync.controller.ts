import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";
import { performCreateSale } from "./sales.controller";

const syncItemSchema = z.object({
  clientUuid: z.string().min(1), // generated on the device when the operation was first queued — the de-dupe key
  deviceId: z.string().min(1),
  operationType: z.literal("create_sale"), // more operation types can be added the same way as offline support grows
  payload: z.any(),
});

const syncBatchSchema = z.object({ operations: z.array(syncItemSchema).min(1).max(100) });

/**
 * Accepts a batch of operations queued while a device was offline and
 * applies each one exactly once, keyed by (storeId, clientUuid) — the
 * unique constraint on sync_queue is the real de-dupe guarantee, this
 * upfront check is just to skip redundant work and give a clean response
 * (spec section 27: "Duplicate Sync", "Network Failure", "Conflict Resolution").
 */
export async function processSyncBatch(req: Request, res: Response) {
  const parsed = syncBatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  const results: Array<{ clientUuid: string; status: "applied" | "already_applied" | "conflict" | "rejected"; saleId?: string; error?: string }> = [];

  for (const op of parsed.data.operations) {
    const existing = await prisma.syncQueueItem.findUnique({ where: { storeId_clientUuid: { storeId, clientUuid: op.clientUuid } } });
    if (existing) {
      results.push({ clientUuid: op.clientUuid, status: existing.status === "applied" ? "already_applied" : (existing.status as any) });
      continue;
    }

    const queueRow = await prisma.syncQueueItem.create({
      data: { tenantId, storeId, deviceId: op.deviceId, clientUuid: op.clientUuid, operationType: op.operationType, payload: op.payload, status: "pending" },
    });

    try {
      if (op.operationType === "create_sale") {
        const salePayload = op.payload; // already validated shape-wise by performCreateSale's internal use, but re-check critical fields
        const sale = await performCreateSale({ tenantId, storeId, userId: req.auth!.userId }, salePayload);
        await prisma.syncQueueItem.update({ where: { id: queueRow.id }, data: { status: "applied" } });
        results.push({ clientUuid: op.clientUuid, status: "applied", saleId: sale.id });
      } else {
        await prisma.syncQueueItem.update({ where: { id: queueRow.id }, data: { status: "rejected" } });
        results.push({ clientUuid: op.clientUuid, status: "rejected", error: "Unknown operation type" });
      }
    } catch (err: any) {
      // Out-of-stock at sync time (someone else sold the last unit while
      // this device was offline) is the classic conflict case — surface it
      // distinctly so the POS UI can prompt the cashier instead of silently
      // losing the sale.
      const isConflict = err?.status === 409;
      await prisma.syncQueueItem.update({ where: { id: queueRow.id }, data: { status: isConflict ? "conflict" : "rejected" } });
      results.push({ clientUuid: op.clientUuid, status: isConflict ? "conflict" : "rejected", error: err?.message || "Failed to apply operation" });
    }
  }

  res.json({ results });
}

export async function listSyncQueue(req: Request, res: Response) {
  const { status } = req.query;
  const where: any = scope(req);
  if (typeof status === "string") where.status = status;
  res.json(await prisma.syncQueueItem.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }));
}

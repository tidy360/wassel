import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";
import { assertUploadAllowed, uploadReceipt, getSignedReceiptUrl } from "../../lib/supabaseStorage";

const uploadSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  base64Data: z.string().min(1), // raw base64, no "data:...;base64," prefix
});

/** Mobile-camera friendly: client sends base64 directly (spec section 25 — photograph a transfer receipt or product). */
export async function uploadFile(req: Request, res: Response) {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const { tenantId, storeId } = scope(req);
  const buffer = Buffer.from(parsed.data.base64Data, "base64");

  try {
    assertUploadAllowed(parsed.data.mimeType, buffer.length);
  } catch (err: any) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  try {
    const { path, signedUrl } = await uploadReceipt({ tenantId, storeId, fileName: parsed.data.fileName, mimeType: parsed.data.mimeType, buffer });
    const file = await prisma.fileAsset.create({ data: { tenantId, storeId, path, fileType: parsed.data.mimeType, uploadedBy: req.auth!.userId } });
    res.status(201).json({ id: file.id, path, signedUrl });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Upload failed" });
  }
}

export async function getFileUrl(req: Request, res: Response) {
  const file = await prisma.fileAsset.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!file) return res.status(404).json({ error: "File not found" });
  const signedUrl = await getSignedReceiptUrl(file.path);
  res.json({ signedUrl });
}

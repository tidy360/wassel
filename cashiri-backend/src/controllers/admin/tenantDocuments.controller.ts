import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { assertUploadAllowed, uploadTenantDocument as uploadToStorage, getSignedReceiptUrl } from "../../lib/supabaseStorage";

const uploadSchema = z.object({
  documentType: z.string().optional(),
  fileName: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  base64Data: z.string().min(1),
});

/** Mobile-camera friendly upload (spec section 12) — private storage, never public. */
export async function uploadTenantDocument(req: Request, res: Response) {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const buffer = Buffer.from(parsed.data.base64Data, "base64");
  try {
    assertUploadAllowed(parsed.data.mimeType, buffer.length);
  } catch (err: any) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  try {
    const { path } = await uploadToStorage({ tenantId: tenant.id, fileName: parsed.data.fileName, mimeType: parsed.data.mimeType, buffer });
    const doc = await prisma.tenantDocument.create({
      data: { tenantId: tenant.id, documentType: parsed.data.documentType, filePath: path, fileName: parsed.data.fileName, uploadedBy: req.auth!.userId },
    });
    await logAudit(req, { action: "tenant_document.uploaded", entity: "TenantDocument", entityId: doc.id, after: { tenantId: tenant.id, documentType: doc.documentType } });
    res.status(201).json(doc);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "Upload failed" });
  }
}

export async function listTenantDocuments(req: Request, res: Response) {
  const docs = await prisma.tenantDocument.findMany({ where: { tenantId: req.params.tenantId }, orderBy: { createdAt: "desc" } });
  res.json(docs);
}

export async function getTenantDocumentUrl(req: Request, res: Response) {
  const doc = await prisma.tenantDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: "Document not found" });
  const signedUrl = await getSignedReceiptUrl(doc.filePath);
  res.json({ signedUrl });
}

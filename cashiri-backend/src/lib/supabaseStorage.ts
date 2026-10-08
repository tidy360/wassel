import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
  auth: { persistSession: false },
});

export const RECEIPTS_BUCKET = "receipts"; // create this bucket (private) once in the Supabase dashboard

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

export function assertUploadAllowed(mimeType: string, sizeBytes: number) {
  if (!ALLOWED_MIME.has(mimeType)) throw Object.assign(new Error("Unsupported file type"), { status: 400 });
  if (sizeBytes > MAX_BYTES) throw Object.assign(new Error("File too large (max 8MB)"), { status: 400 });
}

/**
 * Tenant/store-scoped path so files can never collide or be listable
 * across tenants: /tenants/{tenantId}/stores/{storeId}/receipts/{filename}
 * (spec section 22). Access happens only through this backend using the
 * service-role key — the bucket itself is private.
 */
export async function uploadReceipt(params: { tenantId: string; storeId: string; fileName: string; mimeType: string; buffer: Buffer }) {
  const path = `tenants/${params.tenantId}/stores/${params.storeId}/receipts/${Date.now()}-${params.fileName}`;
  const { error } = await supabaseAdmin.storage.from(RECEIPTS_BUCKET).upload(path, params.buffer, { contentType: params.mimeType, upsert: false });
  if (error) throw Object.assign(new Error(`Upload failed: ${error.message}`), { status: 500 });

  // Bucket is private — issue a short-lived signed URL for the client to preview/print.
  const { data: signed, error: signError } = await supabaseAdmin.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60 * 60);
  if (signError) throw Object.assign(new Error(`Failed to sign URL: ${signError.message}`), { status: 500 });

  return { path, signedUrl: signed.signedUrl };
}

export async function getSignedReceiptUrl(path: string, expiresInSeconds = 3600) {
  const { data, error } = await supabaseAdmin.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw Object.assign(new Error(`Failed to sign URL: ${error.message}`), { status: 500 });
  return data.signedUrl;
}

/**
 * Tenant KYC/ID documents (spec section 12) — reuses the same private
 * bucket as receipts but under its own path prefix:
 * /tenants/{tenantId}/kyc-documents/{filename}. Never public; only ever
 * reachable through a short-lived signed URL issued by the backend.
 */
export async function uploadTenantDocument(params: { tenantId: string; fileName: string; mimeType: string; buffer: Buffer }) {
  const path = `tenants/${params.tenantId}/kyc-documents/${Date.now()}-${params.fileName}`;
  const { error } = await supabaseAdmin.storage.from(RECEIPTS_BUCKET).upload(path, params.buffer, { contentType: params.mimeType, upsert: false });
  if (error) throw Object.assign(new Error(`Upload failed: ${error.message}`), { status: 500 });
  return { path };
}

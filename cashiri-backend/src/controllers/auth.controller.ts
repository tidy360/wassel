import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signAuthToken } from "../lib/token";

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false),
});

const passwordResetTokens = new Map<string, { userId: string; expiresAt: number }>();

const forgotPasswordSchema = z.object({ identifier: z.string().min(1) });
const resetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(4) });

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const { identifier, password, rememberMe } = parsed.data;

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
    include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
  });

  // Same generic error whether the email doesn't exist or the password is
  // wrong — never let a login endpoint reveal which one it was.
  const invalid = () => res.status(401).json({ error: "Invalid email or password" });

  if (!user || user.status !== "active") return invalid();

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return invalid();

  const roles = user.userRoles.map((ur) => ur.role.name);
  const permissions = Array.from(
    new Set(user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code)))
  );

  const token = signAuthToken({
    userId: user.id,
    tenantId: user.tenantId,
    storeId: user.storeId,
    allStoresAccess: user.allStoresAccess,
    isSuperAdmin: user.isSuperAdmin,
    roles,
    permissions,
  }, rememberMe ? "30d" : undefined);

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      tenantId: user.tenantId,
      storeId: user.storeId,
      allStoresAccess: user.allStoresAccess,
      isSuperAdmin: user.isSuperAdmin,
      roles,
    },
  });
}

/** Creates a short-lived reset token. In local development it is returned so the flow can be tested without an email provider. */
export async function forgotPassword(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const user = await prisma.user.findFirst({ where: { OR: [{ email: parsed.data.identifier }, { username: parsed.data.identifier }] } });
  const response: { message: string; resetToken?: string } = { message: "إذا كان الحساب موجودًا، فسيتم إرسال تعليمات استعادة كلمة المرور." };
  if (user) {
    const resetToken = crypto.randomBytes(32).toString("hex");
    passwordResetTokens.set(resetToken, { userId: user.id, expiresAt: Date.now() + 15 * 60 * 1000 });
    if (process.env.NODE_ENV !== "production") response.resetToken = resetToken;
  }
  return res.json(response);
}

export async function resetPassword(req: Request, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const reset = passwordResetTokens.get(parsed.data.token);
  if (!reset || reset.expiresAt < Date.now()) {
    passwordResetTokens.delete(parsed.data.token);
    return res.status(400).json({ error: "Reset code is invalid or expired" });
  }

  await prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) } });
  passwordResetTokens.delete(parsed.data.token);
  return res.json({ message: "Password reset successfully" });
}

export async function me(req: Request, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "Not authenticated" });
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    tenantId: user.tenantId,
    storeId: user.storeId,
    isSuperAdmin: user.isSuperAdmin,
    roles: req.auth.roles,
    permissions: req.auth.permissions,
  });
}

const updateMeSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4).optional(),
});

/**
 * Lets ANY logged-in user — including the platform Super Admin — change
 * their own email/name/password from inside the app. Always requires the
 * current password as proof of identity, even when changing just the name.
 */
export async function updateMe(req: Request, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "Not authenticated" });
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

  if (parsed.data.email && parsed.data.email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) return res.status(409).json({ error: "A user with this email already exists" });
  }

  const data: { name?: string; email?: string; passwordHash?: string } = {};
  if (parsed.data.name) data.name = parsed.data.name;
  if (parsed.data.email) data.email = parsed.data.email;
  if (parsed.data.newPassword) data.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  const updated = await prisma.user.update({ where: { id: user.id }, data });
  res.json({ id: updated.id, name: updated.name, email: updated.email });
}

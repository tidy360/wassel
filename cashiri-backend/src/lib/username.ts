import { Prisma, PrismaClient } from "@prisma/client";

function slug(value: string) {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
  return normalized || "user";
}

export async function generateUsername(db: PrismaClient | Prisma.TransactionClient, name: string, email?: string | null) {
  const base = slug(email?.split("@")[0] || name);
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = Math.floor(1000 + Math.random() * 9000);
    const username = `${base}#${code}`;
    const existing = await db.user.findUnique({ where: { username }, select: { id: true } });
    if (!existing) return username;
  }
  throw Object.assign(new Error("Could not generate a unique username"), { status: 500 });
}

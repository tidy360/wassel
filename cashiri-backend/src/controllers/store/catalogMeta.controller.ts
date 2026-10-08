import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";

const nameSchema = z.object({ name: z.string().min(1) });

export async function listCategories(req: Request, res: Response) {
  res.json(await prisma.category.findMany({ where: scope(req), orderBy: { name: "asc" } }));
}
export async function createCategory(req: Request, res: Response) {
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  res.status(201).json(await prisma.category.create({ data: { ...parsed.data, ...scope(req) } }));
}
export async function deleteCategory(req: Request, res: Response) {
  const existing = await prisma.category.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!existing) return res.status(404).json({ error: "Category not found" });
  await prisma.category.delete({ where: { id: existing.id } });
  res.status(204).send();
}

export async function listUnits(req: Request, res: Response) {
  res.json(await prisma.unit.findMany({ where: scope(req), orderBy: { name: "asc" } }));
}
export async function createUnit(req: Request, res: Response) {
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  res.status(201).json(await prisma.unit.create({ data: { ...parsed.data, ...scope(req) } }));
}

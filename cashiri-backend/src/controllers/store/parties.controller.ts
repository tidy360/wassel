import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { scope } from "../../middleware/storeScope";

const partySchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional(),
  taxNumber: z.string().optional(),
});

// ---------- Suppliers ----------

export async function listSuppliers(req: Request, res: Response) {
  res.json(await prisma.supplier.findMany({ where: scope(req), orderBy: { name: "asc" } }));
}
export async function createSupplier(req: Request, res: Response) {
  const parsed = partySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  res.status(201).json(await prisma.supplier.create({ data: { ...parsed.data, ...scope(req) } }));
}
export async function updateSupplier(req: Request, res: Response) {
  const parsed = partySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const existing = await prisma.supplier.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!existing) return res.status(404).json({ error: "Supplier not found" });
  res.json(await prisma.supplier.update({ where: { id: existing.id }, data: parsed.data }));
}
export async function getSupplierStatement(req: Request, res: Response) {
  const supplier = await prisma.supplier.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });
  const [purchases, payments] = await Promise.all([
    prisma.purchase.findMany({ where: { supplierId: supplier.id, ...scope(req) }, orderBy: { createdAt: "desc" }, include: { items: true } }),
    prisma.payment.findMany({ where: { partyType: "supplier", partyId: supplier.id, ...scope(req) }, orderBy: { createdAt: "desc" } }),
  ]);
  const productIds = [...new Set(purchases.flatMap((purchase) => purchase.items.map((item) => item.productId)))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, ...scope(req) }, select: { id: true, name: true, salePrice: true } });
  const productById = new Map(products.map((product) => [product.id, product]));
  res.json({
    supplier,
    purchases: purchases.map((purchase) => ({
      ...purchase,
      items: purchase.items.map((item) => ({ ...item, productName: productById.get(item.productId)?.name ?? item.productId, salePrice: productById.get(item.productId)?.salePrice ?? 0 })),
    })),
    payments,
  });
}

// ---------- Customers ----------

export async function listCustomers(req: Request, res: Response) {
  const customers = await prisma.customer.findMany({ where: scope(req), include: { _count: { select: { installmentPlans: true } } }, orderBy: { name: "asc" } });
  res.json(customers.map(({ _count, ...customer }) => ({ ...customer, installmentPlansCount: _count.installmentPlans })));
}
export async function createCustomer(req: Request, res: Response) {
  const parsed = partySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  res.status(201).json(await prisma.customer.create({ data: { ...parsed.data, ...scope(req) } }));
}
export async function updateCustomer(req: Request, res: Response) {
  const parsed = partySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const existing = await prisma.customer.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!existing) return res.status(404).json({ error: "Customer not found" });
  res.json(await prisma.customer.update({ where: { id: existing.id }, data: parsed.data }));
}
export async function getCustomerStatement(req: Request, res: Response) {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const [sales, payments, installmentPlans] = await Promise.all([
    prisma.sale.findMany({ where: { customerId: customer.id, ...scope(req) }, orderBy: { createdAt: "desc" } }),
    prisma.payment.findMany({ where: { partyType: "customer", partyId: customer.id, ...scope(req) }, orderBy: { createdAt: "desc" } }),
    prisma.customerInstallmentPlan.findMany({ where: { customerId: customer.id, ...scope(req) }, include: { installments: { orderBy: { installmentNumber: "asc" } }, sale: { select: { invoiceNumber: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  res.json({ customer, sales, payments, installmentPlans });
}

import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { scope } from "../../middleware/storeScope";

// ---------- Expenses ----------

const expenseSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  amount: z.number().positive(),
  expenseType: z.enum(["one_time", "recurring"]).default("one_time"),
  recurrencePeriod: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  paymentMethodId: z.string().uuid().optional(),
  description: z.string().optional(),
  attachmentUrl: z.string().url().optional(),
});

export async function listExpenses(req: Request, res: Response) {
  res.json(await prisma.expense.findMany({ where: scope(req), orderBy: { createdAt: "desc" } }));
}
export async function createExpense(req: Request, res: Response) {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const expense = await prisma.expense.create({ data: { ...parsed.data, ...scope(req), createdBy: req.auth!.userId } });
  await logAudit(req, { action: "expense.created", entity: "Expense", entityId: expense.id, after: expense });
  res.status(201).json(expense);
}

export async function updateExpense(req: Request, res: Response) {
  const parsed = expenseSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid expense", details: parsed.error.flatten() });
  const expense = await prisma.expense.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  const updated = await prisma.expense.update({ where: { id: expense.id }, data: parsed.data });
  await logAudit(req, { action: "expense.updated", entity: "Expense", entityId: updated.id, before: expense, after: updated });
  res.json(updated);
}

export async function deleteExpense(req: Request, res: Response) {
  const expense = await prisma.expense.findFirst({ where: { id: req.params.id, ...scope(req) } });
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  await prisma.expense.delete({ where: { id: expense.id } });
  await logAudit(req, { action: "expense.deleted", entity: "Expense", entityId: expense.id, before: expense });
  res.json({ id: expense.id, deleted: true });
}

// ---------- Payments (customer/supplier settlements) ----------

const paymentSchema = z.object({
  partyType: z.enum(["customer", "supplier"]),
  partyId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethodId: z.string().uuid().optional(),
  attachmentUrl: z.string().url().optional(),
});

export async function createPayment(req: Request, res: Response) {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { tenantId, storeId } = scope(req);
  const { partyType, partyId, amount, paymentMethodId, attachmentUrl } = parsed.data;

  const payment = await prisma.$transaction(async (tx) => {
    const paymentMethod = paymentMethodId
      ? await tx.paymentMethod.findFirst({ where: { id: paymentMethodId, tenantId, storeId, isActive: true } })
      : null;
    if (paymentMethodId && !paymentMethod) throw Object.assign(new Error("Invalid payment method"), { status: 400 });
    if (paymentMethod?.requiresAttachment && !attachmentUrl) {
      throw Object.assign(new Error("This payment method requires a transfer receipt attachment"), { status: 400 });
    }

    if (partyType === "customer") {
      const customer = await tx.customer.findUnique({ where: { id: partyId }, select: { balance: true } });
      if (!customer) throw Object.assign(new Error("Customer not found"), { status: 404 });
      if (amount > Number(customer.balance)) throw Object.assign(new Error("Payment amount exceeds customer balance"), { status: 400 });
    } else {
      const supplier = await tx.supplier.findUnique({ where: { id: partyId }, select: { balance: true } });
      if (!supplier) throw Object.assign(new Error("Supplier not found"), { status: 404 });
      const maxAllowed = Math.abs(Number(supplier.balance));
      if (amount > maxAllowed) throw Object.assign(new Error(`Payment amount exceeds required supplier balance (${maxAllowed})`), { status: 400 });
    }

    const created = await tx.payment.create({ data: { tenantId, storeId, partyType, partyId, amount, paymentMethodId, attachmentUrl, createdBy: req.auth!.userId } });
    if (partyType === "customer") {
      await tx.customer.update({ where: { id: partyId }, data: { balance: { decrement: amount } } });
    } else {
      await tx.supplier.update({ where: { id: partyId }, data: { balance: { increment: amount } } });
    }
    return created;
  });

  await logAudit(req, { action: "payment.recorded", entity: "Payment", entityId: payment.id, after: payment });
  res.status(201).json(payment);
}

// ---------- Cash sessions / Daily closing ----------

export async function openCashSession(req: Request, res: Response) {
  const { openingCash } = z.object({ openingCash: z.number().nonnegative() }).parse(req.body);
  const { tenantId, storeId } = scope(req);

  const open = await prisma.cashSession.findFirst({ where: { tenantId, storeId, status: "open" } });
  if (open) return res.status(409).json({ error: "There is already an open cash session for this store" });

  const session = await prisma.cashSession.create({ data: { tenantId, storeId, openingCash, openedBy: req.auth!.userId, status: "open" } });
  res.status(201).json(session);
}

/**
 * Closes the day: totals sales, expenses and returns since the session
 * opened, compares expected vs counted cash (spec section 24). After
 * closing, enforce "no editing past a closed day" at the permission layer
 * (e.g. an `edit_closed_period` permission gating later edits).
 */
export async function closeCashSession(req: Request, res: Response) {
  const { actualCash } = z.object({ actualCash: z.number().nonnegative() }).parse(req.body);
  const { tenantId, storeId } = scope(req);

  const session = await prisma.cashSession.findFirst({ where: { id: req.params.id, tenantId, storeId, status: "open" } });
  if (!session) return res.status(404).json({ error: "Open cash session not found" });

  const [sales, expenses, returns] = await Promise.all([
    prisma.sale.findMany({ where: { tenantId, storeId, status: { in: ["completed", "partially_returned"] }, createdAt: { gte: session.openedAt } } }),
    prisma.expense.aggregate({ where: { tenantId, storeId, createdAt: { gte: session.openedAt } }, _sum: { amount: true } }),
    prisma.saleReturn.aggregate({ where: { tenantId, storeId, createdAt: { gte: session.openedAt } }, _sum: { total: true } }),
  ]);

  const salesTotal = sales.reduce((sum, s) => sum.add(s.total), new Prisma.Decimal(0)); // per-payment-method breakdown lands in the reports module (Phase 8)
  const expected = session.openingCash.add(salesTotal).sub(expenses._sum.amount ?? 0).sub(returns._sum.total ?? 0);
  const difference = new Prisma.Decimal(actualCash).sub(expected);

  const closed = await prisma.cashSession.update({
    where: { id: session.id },
    data: { status: "closed", closedBy: req.auth!.userId, closedAt: new Date(), expectedCash: expected, actualCash, difference },
  });

  await logAudit(req, { action: "cash_session.closed", entity: "CashSession", entityId: closed.id, after: closed });
  res.json(closed);
}

export async function listCashSessions(req: Request, res: Response) {
  res.json(await prisma.cashSession.findMany({ where: scope(req), orderBy: { openedAt: "desc" }, take: 60 }));
}

export async function getCurrentCashSession(req: Request, res: Response) {
  const session = await prisma.cashSession.findFirst({
    where: { ...scope(req), status: "open" },
    orderBy: { openedAt: "desc" },
  });
  res.json(session);
}


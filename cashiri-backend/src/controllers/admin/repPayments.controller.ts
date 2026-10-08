import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

const paymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().date().optional(),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
  referenceNumber: z.string().optional(),
  proofFilePath: z.string().optional(),
});

/**
 * Records a payment TO a sales rep and allocates it against their oldest
 * outstanding commissions first (FIFO), never paying out more than the
 * rep's actual remaining balance (spec section 15: "دفع مندوب بأكثر من
 * الرصيد المستحق" must be blocked). Snapshots the due/remaining totals at
 * the moment of payment onto the row itself, so the receipt (section 7)
 * stays accurate forever even after later payments change the rep's
 * running balance.
 */
export async function createSalesRepPayment(req: Request, res: Response) {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const rep = await prisma.salesRep.findUnique({ where: { id: req.params.id } });
  if (!rep) return res.status(404).json({ error: "Sales rep not found" });

  const outstandingAgg = await prisma.salesRepCommission.aggregate({
    where: { salesRepId: rep.id, status: { in: ["due", "partially_paid"] } },
    _sum: { remainingAmount: true },
  });
  const outstandingBefore = outstandingAgg._sum.remainingAmount ?? new Prisma.Decimal(0);
  const paymentAmount = new Prisma.Decimal(parsed.data.amount);

  if (paymentAmount.gt(outstandingBefore)) {
    return res.status(409).json({ error: `Payment (${paymentAmount}) exceeds the rep's outstanding balance (${outstandingBefore})` });
  }

  const remainingAfter = outstandingBefore.sub(paymentAmount);

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.salesRepPayment.create({
      data: {
        salesRepId: rep.id,
        amount: paymentAmount,
        paymentDate: parsed.data.paymentDate ? new Date(parsed.data.paymentDate) : new Date(),
        paymentMethod: parsed.data.paymentMethod,
        notes: parsed.data.notes,
        referenceNumber: parsed.data.referenceNumber,
        proofFilePath: parsed.data.proofFilePath,
        totalDueBefore: outstandingBefore,
        remainingAfter,
        createdBy: req.auth!.userId,
      },
    });

    // Allocate FIFO against oldest outstanding commissions.
    const dueCommissions = await tx.salesRepCommission.findMany({
      where: { salesRepId: rep.id, status: { in: ["due", "partially_paid"] } },
      orderBy: { createdAt: "asc" },
    });

    let remainingToAllocate = paymentAmount;
    for (const commission of dueCommissions) {
      if (remainingToAllocate.lte(0)) break;
      const applyAmount = Prisma.Decimal.min(remainingToAllocate, commission.remainingAmount);
      const newPaid = commission.paidAmount.add(applyAmount);
      const newRemaining = commission.remainingAmount.sub(applyAmount);

      await tx.salesRepCommission.update({
        where: { id: commission.id },
        data: { paidAmount: newPaid, remainingAmount: newRemaining, status: newRemaining.lte(0) ? "paid" : "partially_paid" },
      });
      await tx.salesRepPaymentAllocation.create({
        data: { salesRepPaymentId: payment.id, salesRepCommissionId: commission.id, amount: applyAmount },
      });

      remainingToAllocate = remainingToAllocate.sub(applyAmount);
    }

    return payment;
  });

  await logAudit(req, { action: "sales_rep.paid", entity: "SalesRepPayment", entityId: result.id, after: { salesRepId: rep.id, amount: result.amount } });
  res.status(201).json(result);
}

export async function listSalesRepPayments(req: Request, res: Response) {
  const payments = await prisma.salesRepPayment.findMany({ where: { salesRepId: req.params.id }, orderBy: { paymentDate: "desc" } });
  res.json(payments);
}

/** Printable/downloadable receipt payload — spec section 7. */
export async function getSalesRepPaymentReceipt(req: Request, res: Response) {
  const payment = await prisma.salesRepPayment.findUnique({ where: { id: req.params.id }, include: { salesRep: true } });
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  const createdByUser = payment.createdBy ? await prisma.user.findUnique({ where: { id: payment.createdBy } }) : null;

  res.json({
    salesRepName: payment.salesRep.name,
    salesRepPhone: payment.salesRep.phone,
    amountPaid: payment.amount,
    paymentDate: payment.paymentDate,
    referenceNumber: payment.referenceNumber,
    totalDueBeforePayment: payment.totalDueBefore,
    remainingAfterPayment: payment.remainingAfter,
    recordedBy: createdByUser?.name ?? null,
  });
}

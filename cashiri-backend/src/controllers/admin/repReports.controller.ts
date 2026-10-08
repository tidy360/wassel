import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * One row per active sales rep for the chosen month/year: tenants brought
 * in, total commissionable payments, total commission due, paid, and
 * remaining — plus each underlying commission transaction (spec section 5).
 */
export async function getMonthlyRepReport(req: Request, res: Response) {
  const month = Number(req.query.month) || new Date().getMonth() + 1; // 1-12
  const year = Number(req.query.year) || new Date().getFullYear();
  const rangeStart = new Date(year, month - 1, 1);
  const rangeEnd = new Date(year, month, 1);

  const reps = await prisma.salesRep.findMany({ orderBy: { name: "asc" } });

  const rows = await Promise.all(
    reps.map(async (rep) => {
      const commissions = await prisma.salesRepCommission.findMany({
        where: { salesRepId: rep.id, createdAt: { gte: rangeStart, lt: rangeEnd } },
        orderBy: { createdAt: "asc" },
      });
      const tenantIds = new Set(commissions.map((c) => c.tenantId));

      const totals = commissions.reduce(
        (acc, c) => ({
          totalPayments: acc.totalPayments.add(c.paymentAmount),
          totalCommission: acc.totalCommission.add(c.commissionAmount),
          totalPaid: acc.totalPaid.add(c.paidAmount),
          totalRemaining: acc.totalRemaining.add(c.remainingAmount),
        }),
        {
          totalPayments: new Prisma.Decimal(0),
          totalCommission: new Prisma.Decimal(0),
          totalPaid: new Prisma.Decimal(0),
          totalRemaining: new Prisma.Decimal(0),
        }
      );

      return {
        salesRepId: rep.id,
        salesRepName: rep.name,
        tenantCount: tenantIds.size,
        operationCount: commissions.length,
        ...totals,
        transactions: commissions,
      };
    })
  );

  res.json({ month, year, reps: rows });
}

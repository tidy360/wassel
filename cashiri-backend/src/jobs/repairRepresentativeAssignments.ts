import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ACTIVE_STATUSES = ["ACTIVE", "EXPIRING_SOON", "SUSPENDED"];

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function wholeMonthsBetween(start: Date, end: Date) {
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  return addMonths(start, months) > end ? months - 1 : months;
}

async function audit(action: string, entityId: string, before: unknown, after: unknown, tenantId: string) {
  await prisma.auditLog.create({
    data: { action, entity: "RepresentativeMerchantAssignment", entityId, tenantId, beforeData: before as any, afterData: after as any },
  });
}

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: { salesRepId: { not: null } },
    include: {
      subscriptions: { orderBy: { startDate: "asc" } },
      representativeAssignments: { orderBy: { startDate: "asc" } },
    },
  });

  for (const tenant of tenants) {
    if (!tenant.salesRepId) continue;
    const assignments = tenant.representativeAssignments
      .filter((assignment) => assignment.representativeId === tenant.salesRepId)
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
    const firstStart = assignments.find((assignment) => assignment.status !== "TERMINATED")?.startDate ?? tenant.subscriptions[0]?.startDate;
    if (!firstStart) continue;
    const annualEnd = addDays(addMonths(firstStart, 12), -1);
    const kept: typeof assignments = [];

    const cycleAssignments = assignments.filter((assignment) => assignment.status !== "TERMINATED" && assignment.startDate <= annualEnd);
    const canonical = cycleAssignments[0];
    if (canonical) {
      const mergedEnd = new Date(Math.min(annualEnd.getTime(), Math.max(...cycleAssignments.map((assignment) => assignment.endDate.getTime()))));
      const canonicalStatus = mergedEnd < new Date() ? "EXPIRED" : "ACTIVE";
      const updatedCanonical = await prisma.representativeMerchantAssignment.update({
        where: { id: canonical.id },
        data: {
          endDate: mergedEnd,
          durationMonths: Math.max(1, wholeMonthsBetween(canonical.startDate, addDays(mergedEnd, 1))),
          status: canonicalStatus,
          terminatedAt: null,
          terminatedBy: null,
          terminationReason: null,
        },
      });
      if (JSON.stringify(canonical) !== JSON.stringify(updatedCanonical)) await audit("ASSIGNMENT_UPDATED", updatedCanonical.id, canonical, updatedCanonical, tenant.id);
      kept.push(updatedCanonical);

      for (const duplicate of cycleAssignments.slice(1)) {
        const updated = await prisma.representativeMerchantAssignment.update({
          where: { id: duplicate.id },
          data: { status: "TERMINATED", terminatedAt: new Date(), terminationReason: "Duplicate assignment merged into the original annual relationship" },
        });
        await audit("ASSIGNMENT_TERMINATED", updated.id, duplicate, updated, tenant.id);
      }
    }

    for (const subscription of tenant.subscriptions) {
      const candidateStart = subscription.startDate < firstStart ? firstStart : subscription.startDate;
      const candidateEnd = new Date(Math.min(addDays(subscription.endDate, -1).getTime(), annualEnd.getTime()));
      if (candidateStart > candidateEnd) continue;
      const covered = kept.some((assignment) =>
        ACTIVE_STATUSES.includes(assignment.status) &&
        assignment.startDate <= candidateEnd &&
        assignment.endDate >= candidateStart
      );
      if (covered) continue;

      const durationMonths = Math.max(1, wholeMonthsBetween(candidateStart, addDays(candidateEnd, 1)));
      const created = await prisma.representativeMerchantAssignment.create({
        data: {
          tenantId: tenant.id,
          merchantId: tenant.id,
          representativeId: tenant.salesRepId,
          startDate: candidateStart,
          endDate: candidateEnd,
          durationMonths,
          status: candidateEnd < new Date() ? "EXPIRED" : "ACTIVE",
          createdBy: "repairRepresentativeAssignments",
        },
      });
      await audit("REPRESENTATIVE_ASSIGNED", created.id, null, created, tenant.id);
      kept.push(created);
    }
  }

  console.log("Representative assignment repair completed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Run this on a schedule (e.g. Render Cron Job, daily): 
 *   node dist/jobs/generateAlerts.js
 * It is idempotent for each alert threshold: an alert is created once for a
 * relationship and threshold, even if the cron runs more than once a day.
 */
async function alreadyNotifiedToday(tenantId: string, storeId: string | null, type: string, message: string) {
  const existing = await prisma.notification.findFirst({
    where: { tenantId, storeId: storeId ?? undefined, type, message },
  });
  return Boolean(existing);
}

async function generateLowStockAlerts() {
  const rows = await prisma.$queryRaw<
    { tenant_id: string; store_id: string; id: string; name: string; current_stock: any; min_stock: any }[]
  >`select tenant_id, store_id, id, name, current_stock, min_stock from products
    where is_active = true and current_stock <= min_stock`;

  for (const row of rows) {
    const type = Number(row.current_stock) <= 0 ? "out_of_stock" : "low_stock";
    const message = Number(row.current_stock) <= 0 ? `نفد المنتج: ${row.name}` : `مخزون منخفض: ${row.name}`;
    if (await alreadyNotifiedToday(row.tenant_id, row.store_id, type, message)) continue;
    await prisma.notification.create({ data: { tenantId: row.tenant_id, storeId: row.store_id, type, message } });
  }
}

async function generateSubscriptionAlerts() {
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const subs = await prisma.subscription.findMany({ where: { status: "active" } });
  for (const sub of subs) {
    let type: string | null = null;
    let message: string | null = null;
    if (sub.endDate < now) { type = "subscription_expired"; message = "الاشتراك منتهي"; }
    else if (sub.endDate <= in7) { type = "subscription_expiring_7"; message = "الاشتراك سينتهي خلال 7 أيام"; }
    else if (sub.endDate <= in30) { type = "subscription_expiring_30"; message = "الاشتراك سينتهي خلال 30 يوم"; }
    if (!type || !message) continue;
    if (await alreadyNotifiedToday(sub.tenantId, null, type, message)) continue;
    await prisma.notification.create({ data: { tenantId: sub.tenantId, storeId: null, type, message } });
  }
}

async function markOverdueInstallments() {
  const now = new Date();
  await prisma.installment.updateMany({
    where: { status: { in: ["due", "partially_paid"] }, dueDate: { lt: now } },
    data: { status: "overdue" },
  });
  await prisma.customerInstallment.updateMany({
    where: { status: { in: ["due", "partially_paid"] }, dueDate: { lt: now } },
    data: { status: "overdue" },
  });
}

async function expireRepresentativeAssignments() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = await prisma.representativeMerchantAssignment.findMany({
    where: { status: { in: ["ACTIVE", "EXPIRING_SOON"] }, endDate: { lt: today } },
    include: { representative: true, merchant: true },
  });
  for (const assignment of due) {
    const result = await prisma.representativeMerchantAssignment.updateMany({
      where: { id: assignment.id, status: { in: ["ACTIVE", "EXPIRING_SOON"] } },
      data: { status: "EXPIRED" },
    });
    if (!result.count) continue;
    await prisma.auditLog.create({
      data: {
        tenantId: assignment.merchantId,
        action: "ASSIGNMENT_EXPIRED",
        entity: "RepresentativeMerchantAssignment",
        entityId: assignment.id,
        beforeData: assignment as any,
        afterData: { ...assignment, status: "EXPIRED" },
      },
    });
    const message = `انتهى ارتباط المندوب ${assignment.representative.name} مع ${assignment.merchant.businessName}`;
    if (!(await alreadyNotifiedToday(assignment.merchantId, assignment.storeId, "representative_assignment_expired", message))) {
      await prisma.notification.create({ data: { tenantId: assignment.merchantId, storeId: assignment.storeId, type: "representative_assignment_expired", message } });
    }
  }

  const soon = await prisma.representativeMerchantAssignment.findMany({
    where: { status: "ACTIVE", endDate: { gte: today, lte: new Date(today.getTime() + 30 * 86400000) } },
    include: { representative: true, merchant: true },
  });
  for (const assignment of soon) {
    await prisma.representativeMerchantAssignment.updateMany({ where: { id: assignment.id, status: "ACTIVE" }, data: { status: "EXPIRING_SOON" } });
    const daysRemaining = Math.ceil((assignment.endDate.getTime() - today.getTime()) / 86400000);
    const threshold = [30, 14, 7, 1].find((days) => daysRemaining <= days);
    if (!threshold) continue;
    const message = daysRemaining === 1
      ? `سينتهي ارتباط المندوب ${assignment.representative.name} مع ${assignment.merchant.businessName} غدًا`
      : `ارتباط المندوب ${assignment.representative.name} مع ${assignment.merchant.businessName} سينتهي خلال ${threshold} يومًا`;
    const type = `representative_assignment_expiring_${threshold}`;
    if (!(await alreadyNotifiedToday(assignment.merchantId, assignment.storeId, type, message))) {
      await prisma.notification.create({ data: { tenantId: assignment.merchantId, storeId: assignment.storeId, type, message } });
    }
  }
}

async function main() {
  await generateLowStockAlerts();
  await generateSubscriptionAlerts();
  await markOverdueInstallments();
  await expireRepresentativeAssignments();
  console.log("Alerts generated.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

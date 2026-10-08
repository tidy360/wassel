import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateUsername } from "../src/lib/username";

const prisma = new PrismaClient();

// Granular STORE-level permission codes (spec section 18)
const STORE_PERMISSIONS = [
  "view_products", "create_products", "edit_products", "delete_products",
  "view_sales", "create_sales", "cancel_invoice", "return_invoice",
  "view_purchases", "create_purchases", "edit_purchases",
  "view_inventory", "edit_inventory",
  "view_customers", "manage_customers",
  "view_suppliers", "manage_suppliers",
  "view_expenses", "create_expenses",
  "view_reports",
  "manage_users",
  "manage_settings",
  "manage_store",
  "close_cash_session",
  "view_audit_log",
  "manufacturing.view", "manufacturing.create", "manufacturing.edit", "manufacturing.delete",
  "manufacturing.approve", "manufacturing.complete", "manufacturing.cancel", "manufacturing.reverse",
    "support.view", "support.create", "support.reply", "support.rate", "support.reopen",
  "bom.view", "bom.create", "bom.edit", "bom.delete", "inventory.reserve",
  "pricing.view", "pricing.create", "pricing.update", "pricing.approve", "pricing.bulk_update",
  "pricing.exchange_rate", "pricing.margin", "pricing.history", "pricing.export",
];

// Platform/admin-level permission codes (sales-rep/commission/subscription
// feature set) — deliberately a SEPARATE list from STORE_PERMISSIONS so a
// store's ADMIN role can never accidentally inherit platform-wide access.
const PLATFORM_PERMISSIONS = [
  "view_tenants", "manage_tenants",
  "manage_subscriptions",
  "manage_plans",
  "view_admin_financials",
  "manage_sales_reps", "pay_sales_reps", "view_sales_rep_reports",
  "representative_assignments.view", "representative_assignments.create", "representative_assignments.edit",
  "representative_assignments.renew", "representative_assignments.terminate", "representative_assignments.suspend",
  "representative_assignments.export",
  "manage_sales_supervisors", "pay_sales_supervisors",
  "view_sales_supervisor_reports", "view_sales_supervisor_dashboard",
  "support.view", "support.reply", "support.change_status", "support.change_priority",
  "support.add_internal_note", "support.view_internal_notes", "support.manage_categories",
  "support.manage_sla", "support.close", "support.reopen", "support.export",
];

const ALL_PERMISSIONS = [...STORE_PERMISSIONS, ...PLATFORM_PERMISSIONS];
const SUPPORT_CATEGORIES = [
  ["مشكلة مع المندوب", "HIGH"], ["مشكلة في الفاتورة", "MEDIUM"], ["مشكلة في المخزون", "MEDIUM"],
  ["مشكلة في النظام", "CRITICAL"], ["مشكلة تقنية", "HIGH"], ["مشكلة في الاشتراك", "MEDIUM"], ["أخرى", "LOW"],
] as const;

// Role -> permission codes (spec section 18)
const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: STORE_PERMISSIONS, // full access within their store(s) — store-level only, never platform-level
  MANAGER: [
    "view_products", "create_products", "edit_products",
    "view_sales", "create_sales", "cancel_invoice", "return_invoice",
    "view_purchases", "create_purchases", "edit_purchases",
    "view_inventory", "edit_inventory",
    "view_customers", "manage_customers",
    "view_suppliers", "manage_suppliers",
    "view_expenses", "create_expenses",
    "view_reports", "close_cash_session",
    "manage_users", "manage_settings", "manage_store", "view_audit_log",
    "manufacturing.view", "manufacturing.create", "manufacturing.edit", "manufacturing.approve",
    "manufacturing.complete", "manufacturing.cancel", "manufacturing.reverse",
    "bom.view", "bom.create", "bom.edit", "bom.delete", "inventory.reserve",
    "pricing.view", "pricing.create", "pricing.update", "pricing.approve", "pricing.bulk_update",
    "pricing.exchange_rate", "pricing.margin", "pricing.history", "pricing.export",
  ],
  CASHIER: [
    "view_products", "create_sales", "view_customers",
    "view_suppliers", "view_expenses", "create_expenses",
  ],
  STORE_STAFF: [
    "view_products", "create_products", "edit_products",
    "view_suppliers", "manage_suppliers",
    "view_inventory", "edit_inventory",
    "bom.view", "bom.create", "bom.edit",
  ],
  // Platform-level roles (used by Super Admin dashboard users who are NOT the
  // platform owner — isSuperAdmin stays false for these, access is gated by
  // requirePermission on /api/admin routes instead of a blanket bypass).
  ACCOUNTANT: [
    // Read-only across financial data — spec section 8 "محاسب"
    "view_admin_financials", "view_sales_rep_reports",
  ],
  CUSTOMER_SERVICE: [
    // Subscription service actions only, no financial visibility — spec section 8 "خدمة العملاء"
    "view_tenants", "manage_subscriptions", "support.view", "support.reply", "support.change_status",
    "support.change_priority", "support.add_internal_note", "support.view_internal_notes", "support.close",
  ],
  SALES_SUPERVISOR: [
    "manage_sales_supervisors", "pay_sales_supervisors",
    "view_sales_supervisor_reports", "view_sales_supervisor_dashboard",
  ],
};

async function main() {
  console.log("Seeding permissions...");
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code },
    });
  }

  console.log("Seeding support categories...");
  await prisma.supportTicketCategory.deleteMany({ where: { name: { in: ["مشكلة في الدفع", "مشكلة في التوصيل", "مشكلة في الطلب"] } } });
  for (const [name, defaultPriority] of SUPPORT_CATEGORIES) {
    await prisma.supportTicketCategory.upsert({ where: { name }, update: { defaultPriority, isActive: true }, create: { name, defaultPriority } });
  }

  console.log("Seeding system roles (tenant_id = null = template roles)...");
  for (const roleName of ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "STORE_STAFF", "ACCOUNTANT", "CUSTOMER_SERVICE", "SALES_SUPERVISOR"]) {
    const role = await prisma.role.upsert({
      where: { id: `system-${roleName.toLowerCase()}` }, // placeholder, real upsert done by name below
      update: {},
      create: { id: `system-${roleName.toLowerCase()}`, name: roleName, isSystem: true },
    }).catch(async () => {
      // fallback if id not stable across reseeds
      const existing = await prisma.role.findFirst({ where: { name: roleName, isSystem: true } });
      if (existing) return existing;
      return prisma.role.create({ data: { name: roleName, isSystem: true } });
    });

    const permCodes = ROLE_PERMISSIONS[roleName] || [];

  // Existing tenant roles may have been created before newer permissions were
  // added to the system templates. Keep their capabilities in sync as well.
  const bomPermissions = await prisma.permission.findMany({ where: { code: { in: ["bom.view", "bom.create", "bom.edit"] } } });
  const existingProductRoles = await prisma.role.findMany({ where: { tenantId: { not: null } } });
  for (const role of existingProductRoles) {
    for (const permission of bomPermissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const code of permCodes) {
      const permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  // Tenant-scoped roles use the same names as the system templates. Keep
  // their permissions synchronized as new capabilities are introduced.
  const allNamedRoles = await prisma.role.findMany({ where: { name: { in: Object.keys(ROLE_PERMISSIONS) } } });
  for (const role of allNamedRoles) {
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const code of ROLE_PERMISSIONS[role.name] ?? []) {
      const permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) continue;
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
  }

  const storeSupportPermissions = await prisma.permission.findMany({ where: { code: { in: ["support.view", "support.create", "support.reply", "support.rate", "support.reopen"] } } });
  const merchantRoles = await prisma.role.findMany({ where: { name: { in: ["ADMIN", "MANAGER", "CASHIER", "STORE_STAFF"] } } });
  for (const role of merchantRoles) {
    for (const permission of storeSupportPermissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const usersWithoutUsername = await prisma.user.findMany({ where: { username: null } });
  for (const user of usersWithoutUsername) {
    await prisma.user.update({ where: { id: user.id }, data: { username: await generateUsername(prisma, user.name, user.email) } });
  }

  // Backfill the first store and its first ADMIN as the merchant-wide owner.
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    const mainStore = await prisma.store.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } });
    if (!mainStore) continue;
    await prisma.store.update({ where: { id: mainStore.id }, data: { isMain: true } });
    const firstAdmin = await prisma.user.findFirst({ where: { tenantId: tenant.id, storeId: mainStore.id, userRoles: { some: { role: { name: "ADMIN" } } } }, orderBy: { createdAt: "asc" } });
    if (firstAdmin) await prisma.user.update({ where: { id: firstAdmin.id }, data: { allStoresAccess: true } });
  }

  // Bootstrap a Super Admin platform user if one doesn't exist yet.
  const superAdminEmail = process.env.SEED_SUPER_ADMIN_EMAIL;
  const superAdminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (superAdminEmail && superAdminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: superAdminEmail } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(superAdminPassword, 12);
      await prisma.user.create({
        data: {
          name: "Super Admin",
          email: superAdminEmail,
          passwordHash,
          isSuperAdmin: true,
          status: "active",
        },
      });
      console.log(`Created Super Admin user: ${superAdminEmail}`);
    }
  } else {
    console.log("Skipping Super Admin bootstrap — set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD env vars to create one.");
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

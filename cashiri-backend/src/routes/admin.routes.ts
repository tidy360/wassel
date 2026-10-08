import { Router } from "express";
import { requireAuth, requireSuperAdmin, requirePlatformUser } from "../middleware/auth";
import { listAdminTickets, getAdminTicket, addTicketMessage, changeTicketStatus, changeTicketPriority, addInternalNote, listSupportCategories, manageSupportCategory, listAdminSupportNotifications, markAdminSupportNotificationRead } from "../controllers/support.controller";
import { requirePermission } from "../middleware/rbac";
import {
  listTenants,
  getTenant,
  createTenant,
  deleteTenant,
  updateTenant,
  setTenantStatus,
} from "../controllers/admin/tenants.controller";
import { listStoresForTenant, listStoreUsers, createStore, setStoreActive, deleteStore } from "../controllers/admin/stores.controller";
import {
  listPlans,
  createPlan,
  updatePlan,
  assignSubscription,
  setSubscriptionStatus,
} from "../controllers/admin/subscriptions.controller";
import { getDashboard } from "../controllers/admin/dashboard.controller";
import { getFinancialDashboard } from "../controllers/admin/financialDashboard.controller";
import { startImpersonation } from "../controllers/admin/impersonation.controller";
import {
  listSuperAdmins, createSuperAdmin, setSuperAdminStatus,
  listPlatformUsers, createPlatformUser, updatePlatformUser, setPlatformUserStatus,
} from "../controllers/admin/superAdmins.controller";
import {
  listSalesReps, createSalesRep, updateSalesRep, setSalesRepStatus,
  getSalesRepPerformance, getSalesRepStatement,
} from "../controllers/admin/salesReps.controller";
import { getMonthlyRepReport } from "../controllers/admin/repReports.controller";
import { createSalesRepPayment, listSalesRepPayments, getSalesRepPaymentReceipt } from "../controllers/admin/repPayments.controller";
import {
  listSalesSupervisors, createSalesSupervisor, updateSalesSupervisor, setSalesSupervisorStatus,
  assignRepToSupervisor, removeRepFromSupervisor, listSupervisorReps, getSalesSupervisorDashboard,
  createSalesSupervisorPayment, listSalesSupervisorPayments, getSalesSupervisorPaymentReceipt,
  getSalesSupervisorReport,
} from "../controllers/admin/salesSupervisors.controller";
import {
  createPaymentPlan, getPaymentPlan, recordInstallmentPayment,
} from "../controllers/admin/paymentPlans.controller";
import { uploadTenantDocument, listTenantDocuments, getTenantDocumentUrl } from "../controllers/admin/tenantDocuments.controller";
import { listAdminAuditLog } from "../controllers/admin/adminAudit.controller";
import {
  listRepresentativeAssignments, getRepresentativeAssignment, createRepresentativeAssignment,
  renewRepresentativeAssignment, terminateRepresentativeAssignment, suspendRepresentativeAssignment,
  reactivateRepresentativeAssignment, updateRepresentativeAssignment, listExpiringAssignments, listAssignmentHistory,
} from "../controllers/admin/representativeAssignments.controller";

const router = Router();

// Every route below requires being logged in as either the platform Super
// Admin or a platform staff account (Accountant / Customer Service — spec
// section 8). Fine-grained access from there is enforced per-route with
// requirePermission(); isSuperAdmin always bypasses those checks.
router.use(requireAuth, requirePlatformUser);

// Support Center
router.get("/support/categories", requirePermission("support.view"), listSupportCategories);
router.get("/support/notifications", requirePermission("support.view"), listAdminSupportNotifications);
router.post("/support/notifications/:id/read", requirePermission("support.view"), markAdminSupportNotificationRead);
router.post("/support/categories", requirePermission("support.manage_categories"), manageSupportCategory);
router.patch("/support/categories/:id", requirePermission("support.manage_categories"), manageSupportCategory);
router.get("/support/tickets", requirePermission("support.view"), listAdminTickets);
router.get("/support/tickets/:id", requirePermission("support.view"), getAdminTicket);
router.post("/support/tickets/:id/messages", requirePermission("support.reply"), addTicketMessage);
router.post("/support/tickets/:id/status", requirePermission("support.change_status"), changeTicketStatus);
router.post("/support/tickets/:id/priority", requirePermission("support.change_priority"), changeTicketPriority);
router.post("/support/tickets/:id/internal-notes", requirePermission("support.add_internal_note"), addInternalNote);

router.get("/dashboard", requirePermission("view_admin_financials"), getDashboard);
router.get("/financial-dashboard", requirePermission("view_admin_financials"), getFinancialDashboard);

router.get("/tenants", requirePermission("view_tenants"), listTenants);
router.post("/tenants", requirePermission("manage_tenants"), createTenant);
router.delete("/tenants/:id", requirePermission("manage_tenants"), deleteTenant);
router.get("/tenants/:id", requirePermission("view_tenants"), getTenant);
router.patch("/tenants/:id", requirePermission("manage_tenants"), updateTenant);
router.post("/tenants/:id/suspend", requirePermission("manage_tenants"), setTenantStatus("suspended"));
router.post("/tenants/:id/activate", requirePermission("manage_tenants"), setTenantStatus("active"));

router.get("/tenants/:tenantId/stores", requirePermission("view_tenants"), listStoresForTenant);
router.get("/tenants/:tenantId/stores/:storeId/users", requirePermission("view_tenants"), listStoreUsers);
router.post("/tenants/:tenantId/stores", requirePermission("manage_tenants"), createStore);
router.post("/stores/:id/suspend", requirePermission("manage_tenants"), setStoreActive(false));
router.post("/stores/:id/activate", requirePermission("manage_tenants"), setStoreActive(true));
router.delete("/stores/:id", requirePermission("manage_tenants"), deleteStore);

router.get("/plans", requirePermission("view_tenants"), listPlans);
router.post("/plans", requirePermission("manage_plans"), createPlan);
router.patch("/plans/:id", requirePermission("manage_plans"), updatePlan);

// Duration-based renewal (spec section 1) — same endpoint handles first
// assignment and every later renewal, each call = one auditable row.
router.post("/tenants/:tenantId/subscriptions", requirePermission("manage_subscriptions"), assignSubscription);
router.post("/subscriptions/:id/cancel", requirePermission("manage_subscriptions"), setSubscriptionStatus("cancelled"));
router.post("/subscriptions/:id/reactivate", requirePermission("manage_subscriptions"), setSubscriptionStatus("active"));

// Deferred / installment payment plans (spec sections 9-11)
router.post("/tenants/:tenantId/payment-plans", requirePermission("manage_subscriptions"), createPaymentPlan);
router.get("/payment-plans/:id", requirePermission("view_tenants"), getPaymentPlan);
router.post("/installments/:id/pay", requirePermission("manage_subscriptions"), recordInstallmentPayment);

// Tenant ID/KYC documents (spec section 12) — private, never public
router.post("/tenants/:tenantId/documents", requirePermission("manage_tenants"), uploadTenantDocument);
router.get("/tenants/:tenantId/documents", requirePermission("view_tenants"), listTenantDocuments);
router.get("/documents/:id/url", requirePermission("view_tenants"), getTenantDocumentUrl);

// Sales reps (spec sections 2-3) — no default role grants this except Super Admin bypass
router.get("/sales-reps", requirePermission("manage_sales_reps"), listSalesReps);
router.post("/sales-reps", requirePermission("manage_sales_reps"), createSalesRep);
router.patch("/sales-reps/:id", requirePermission("manage_sales_reps"), updateSalesRep);
router.post("/sales-reps/:id/disable", requirePermission("manage_sales_reps"), setSalesRepStatus("disabled"));
router.post("/sales-reps/:id/enable", requirePermission("manage_sales_reps"), setSalesRepStatus("active"));
router.get("/sales-reps/:id/performance", requirePermission("view_sales_rep_reports"), getSalesRepPerformance);
router.get("/sales-reps/:id/statement", requirePermission("view_sales_rep_reports"), getSalesRepStatement);
router.get("/sales-reps/reports/monthly", requirePermission("view_sales_rep_reports"), getMonthlyRepReport);

router.get("/representative-assignments", requirePermission("representative_assignments.view"), listRepresentativeAssignments);
router.post("/representative-assignments", requirePermission("representative_assignments.create"), createRepresentativeAssignment);
router.get("/representative-assignments/expiring", requirePermission("representative_assignments.view"), listExpiringAssignments);
router.get("/representative-assignments/history", requirePermission("representative_assignments.view"), listAssignmentHistory);
router.get("/representative-assignments/:id", requirePermission("representative_assignments.view"), getRepresentativeAssignment);
router.put("/representative-assignments/:id", requirePermission("representative_assignments.edit"), updateRepresentativeAssignment);
router.post("/representative-assignments/:id/renew", requirePermission("representative_assignments.renew"), renewRepresentativeAssignment);
router.post("/representative-assignments/:id/terminate", requirePermission("representative_assignments.terminate"), terminateRepresentativeAssignment);
router.post("/representative-assignments/:id/suspend", requirePermission("representative_assignments.suspend"), suspendRepresentativeAssignment);
router.post("/representative-assignments/:id/reactivate", requirePermission("representative_assignments.edit"), reactivateRepresentativeAssignment);

router.get("/sales-supervisors", requirePermission("manage_sales_supervisors"), listSalesSupervisors);
router.post("/sales-supervisors", requirePermission("manage_sales_supervisors"), createSalesSupervisor);
router.patch("/sales-supervisors/:id", requirePermission("manage_sales_supervisors"), updateSalesSupervisor);
router.post("/sales-supervisors/:id/disable", requirePermission("manage_sales_supervisors"), setSalesSupervisorStatus("disabled"));
router.post("/sales-supervisors/:id/enable", requirePermission("manage_sales_supervisors"), setSalesSupervisorStatus("active"));
router.get("/sales-supervisors/:id/dashboard", requirePermission("view_sales_supervisor_dashboard"), getSalesSupervisorDashboard);
router.get("/sales-supervisors/:id/report", requirePermission("view_sales_supervisor_reports"), getSalesSupervisorReport);
router.get("/sales-supervisors/:id/reps", requirePermission("view_sales_supervisor_reports"), listSupervisorReps);
router.post("/sales-supervisors/:id/reps/:repId", requirePermission("manage_sales_supervisors"), assignRepToSupervisor);
router.delete("/sales-supervisors/:id/reps/:repId", requirePermission("manage_sales_supervisors"), removeRepFromSupervisor);
router.post("/sales-supervisors/:id/payments", requirePermission("pay_sales_supervisors"), createSalesSupervisorPayment);
router.get("/sales-supervisors/:id/payments", requirePermission("view_sales_supervisor_reports"), listSalesSupervisorPayments);
router.get("/sales-supervisor-payments/:id/receipt", requirePermission("view_sales_supervisor_reports"), getSalesSupervisorPaymentReceipt);

// Sales rep payments (spec sections 6-7)
router.post("/sales-reps/:id/payments", requirePermission("pay_sales_reps"), createSalesRepPayment);
router.get("/sales-reps/:id/payments", requirePermission("view_sales_rep_reports"), listSalesRepPayments);
router.get("/sales-rep-payments/:id/receipt", requirePermission("view_sales_rep_reports"), getSalesRepPaymentReceipt);

// Impersonation and platform-account management stay literal-Super-Admin-only.
router.post("/tenants/:tenantId/stores/:storeId/impersonate", requireSuperAdmin, startImpersonation);

router.get("/super-admins", requireSuperAdmin, listSuperAdmins);
router.post("/super-admins", requireSuperAdmin, createSuperAdmin);
router.post("/super-admins/:id/disable", requireSuperAdmin, setSuperAdminStatus("disabled"));
router.post("/super-admins/:id/enable", requireSuperAdmin, setSuperAdminStatus("active"));

router.get("/platform-users", requireSuperAdmin, listPlatformUsers);
router.post("/platform-users", requireSuperAdmin, createPlatformUser);
router.patch("/platform-users/:id", requireSuperAdmin, updatePlatformUser);
router.post("/platform-users/:id/disable", requireSuperAdmin, setPlatformUserStatus("disabled"));
router.post("/platform-users/:id/enable", requireSuperAdmin, setPlatformUserStatus("active"));

router.get("/audit-log", requirePermission("view_admin_financials"), listAdminAuditLog);

export default router;

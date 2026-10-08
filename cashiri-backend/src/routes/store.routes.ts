import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireStoreUser } from "../middleware/storeScope";
import { requirePermission } from "../middleware/rbac";
import { blockDestructiveWhileImpersonating } from "../middleware/impersonation";

import { getMyStore, updateMyStore, listTaxes, upsertTax, listPaymentMethods, upsertPaymentMethod } from "../controllers/store/settings.controller";
import { listUsers, createUser, setUserStatus, changeUserRole } from "../controllers/store/users.controller";
import { getMerchantDashboard } from "../controllers/store/dashboard.controller";
import { listCategories, createCategory, deleteCategory, listUnits, createUnit } from "../controllers/store/catalogMeta.controller";
import { listProducts, getProductByBarcode, getProduct, createProduct, updateProduct, deactivateProduct } from "../controllers/store/products.controller";
import { listSuppliers, createSupplier, updateSupplier, getSupplierStatement, listCustomers, createCustomer, updateCustomer, getCustomerStatement } from "../controllers/store/parties.controller";
import { createSale, listSales, getSale, cancelSale, returnSale } from "../controllers/store/sales.controller";
import { getSalePdf } from "../controllers/store/invoicePdf.controller";
import { createPurchase, listPurchases, getPurchase, returnPurchase, adjustStock, listMovements } from "../controllers/store/purchases.controller";
import { listExpenses, createExpense, updateExpense, deleteExpense, createPayment, openCashSession, closeCashSession, listCashSessions, getCurrentCashSession } from "../controllers/store/finance.controller";
import { salesReport, purchasesReport, taxDeclarationReport, profitReport, expensesReport, inventoryValuationReport, lowStockReport, topProductsReport, cancelledInvoicesReport } from "../controllers/store/reports.controller";
import { listAuditLog, listNotifications, markNotificationRead } from "../controllers/store/auditNotifications.controller";
import { uploadFile, getFileUrl } from "../controllers/store/files.controller";
import { processSyncBatch, listSyncQueue } from "../controllers/store/sync.controller";
import { payCustomerInstallment } from "../controllers/store/customerInstallments.controller";
import { getProductBom, createProductBom, listManufacturingOrders, getManufacturingOrder, createManufacturingOrder, reserveManufacturingOrder, completeManufacturingOrder, cancelManufacturingOrder } from "../controllers/store/manufacturing.controller";
import { listMerchantTickets, getMerchantTicket, createMerchantTicket, addTicketMessage, rateMerchantTicket, listSupportCategories, getMerchantRepresentative } from "../controllers/support.controller";
import { listMyStores, setMyStoreStatus } from "../controllers/store/stores.controller";
import { getPricingSettingsHandler, updatePricingSettings, listExchangeRates, createExchangeRate, updateExchangeRate, listPricingProducts, getPricingProduct, updateProductPricing, recalculateProduct, approveProductPrice, rejectProductPrice, bulkPreview, bulkApprove, listPriceChanges, listPriceHistory, listPricingAlerts } from "../controllers/store/pricing.controller";

const router = Router();

router.use(requireAuth, requireStoreUser);

// Support and complaints
router.get("/support/categories", requirePermission("support.view"), listSupportCategories);
router.get("/support/representative", requirePermission("support.view"), getMerchantRepresentative);
router.get("/support/tickets", requirePermission("support.view"), listMerchantTickets);
router.post("/support/tickets", requirePermission("support.create"), createMerchantTicket);
router.get("/support/tickets/:id", requirePermission("support.view"), getMerchantTicket);
router.post("/support/tickets/:id/messages", requirePermission("support.reply"), addTicketMessage);
router.post("/support/tickets/:id/rating", requirePermission("support.rate"), rateMerchantTicket);

// Dashboard
router.get("/dashboard", getMerchantDashboard);

// Store settings (section 28)
router.get("/settings/store", getMyStore);
router.patch("/settings/store", requirePermission("manage_store"), updateMyStore);
router.get("/stores", requirePermission("manage_store"), listMyStores);
router.patch("/stores/:id/status", requirePermission("manage_store"), setMyStoreStatus);
router.get("/settings/taxes", listTaxes);
router.post("/settings/taxes", requirePermission("manage_settings"), upsertTax);
router.patch("/settings/taxes/:id", requirePermission("manage_settings"), upsertTax);
router.get("/settings/payment-methods", listPaymentMethods);
router.post("/settings/payment-methods", requirePermission("manage_settings"), upsertPaymentMethod);
router.patch("/settings/payment-methods/:id", requirePermission("manage_settings"), upsertPaymentMethod);

// Users (section 20)
router.get("/users", requirePermission("manage_users"), listUsers);
router.post("/users", requirePermission("manage_users"), createUser);
router.post("/users/:id/disable", requirePermission("manage_users"), blockDestructiveWhileImpersonating, setUserStatus("disabled"));
router.post("/users/:id/enable", requirePermission("manage_users"), setUserStatus("active"));
router.patch("/users/:id/role", requirePermission("manage_users"), blockDestructiveWhileImpersonating, changeUserRole);

// Catalog (section 9)
router.get("/categories", listCategories);
router.post("/categories", requirePermission("create_products"), createCategory);
router.delete("/categories/:id", requirePermission("delete_products"), blockDestructiveWhileImpersonating, deleteCategory);
router.get("/units", listUnits);
router.post("/units", requirePermission("create_products"), createUnit);

router.get("/products", requirePermission("view_products"), listProducts);
router.get("/products/barcode/:barcode", requirePermission("view_products"), getProductByBarcode);
router.get("/products/:id", requirePermission("view_products"), getProduct);
router.post("/products", requirePermission("create_products"), createProduct);
router.patch("/products/:id", requirePermission("edit_products"), updateProduct);
router.post("/products/:id/deactivate", requirePermission("delete_products"), blockDestructiveWhileImpersonating, deactivateProduct);

// Dynamic pricing: current salePrice remains authoritative until approval.
router.get("/pricing/products", requirePermission("pricing.view"), listPricingProducts);
router.get("/pricing/products/:id", requirePermission("pricing.view"), getPricingProduct);
router.patch("/pricing/products/:id", requirePermission("pricing.update"), updateProductPricing);
router.post("/pricing/products/:id/recalculate", requirePermission("pricing.update"), recalculateProduct);
router.post("/pricing/proposals/:id/approve", requirePermission("pricing.approve"), approveProductPrice);
router.post("/pricing/proposals/:id/reject", requirePermission("pricing.approve"), rejectProductPrice);
router.post("/pricing/bulk-preview", requirePermission("pricing.bulk_update"), bulkPreview);
router.post("/pricing/bulk-approve", requirePermission("pricing.bulk_update"), bulkApprove);
router.get("/pricing/changes", requirePermission("pricing.view"), listPriceChanges);
router.get("/pricing/history/:productId", requirePermission("pricing.history"), listPriceHistory);
router.get("/pricing/alerts", requirePermission("pricing.view"), listPricingAlerts);
router.get("/pricing/settings", requirePermission("pricing.view"), getPricingSettingsHandler);
router.put("/pricing/settings", requirePermission("pricing.margin"), updatePricingSettings);
router.get("/exchange-rates", requirePermission("pricing.exchange_rate"), listExchangeRates);
router.post("/exchange-rates", requirePermission("pricing.exchange_rate"), createExchangeRate);
router.put("/exchange-rates/:id", requirePermission("pricing.exchange_rate"), updateExchangeRate);

// BOM and manufacturing
router.get("/products/:productId/bom", requirePermission("bom.view"), getProductBom);
router.post("/products/:productId/bom", requirePermission("bom.create"), createProductBom);
router.get("/manufacturing-orders", requirePermission("manufacturing.view"), listManufacturingOrders);
router.get("/manufacturing-orders/:id", requirePermission("manufacturing.view"), getManufacturingOrder);
router.post("/manufacturing-orders", requirePermission("manufacturing.create"), createManufacturingOrder);
router.post("/manufacturing-orders/:id/reserve", requirePermission("inventory.reserve"), reserveManufacturingOrder);
router.post("/manufacturing-orders/:id/complete", requirePermission("manufacturing.complete"), completeManufacturingOrder);
router.post("/manufacturing-orders/:id/cancel", requirePermission("manufacturing.cancel"), blockDestructiveWhileImpersonating, cancelManufacturingOrder);

// Suppliers & customers (sections 12, 13)
router.get("/suppliers", requirePermission("view_suppliers"), listSuppliers);
router.post("/suppliers", requirePermission("manage_suppliers"), createSupplier);
router.patch("/suppliers/:id", requirePermission("manage_suppliers"), updateSupplier);
router.get("/suppliers/:id/statement", requirePermission("view_suppliers"), getSupplierStatement);

router.get("/customers", requirePermission("view_customers"), listCustomers);
router.post("/customers", requirePermission("manage_customers"), createCustomer);
router.patch("/customers/:id", requirePermission("manage_customers"), updateCustomer);
router.get("/customers/:id/statement", requirePermission("view_customers"), getCustomerStatement);
router.post("/customer-installments/:id/pay", requirePermission("manage_customers"), payCustomerInstallment);

// POS / Sales (sections 4-8)
router.get("/sales", requirePermission("view_sales"), listSales);
router.get("/sales/:id", requirePermission("view_sales"), getSale);
router.get("/sales/:id/pdf", requirePermission("view_sales"), getSalePdf);
router.post("/sales", requirePermission("create_sales"), createSale);
router.post("/sales/:id/cancel", requirePermission("cancel_invoice"), cancelSale);
router.post("/sales/:id/return", requirePermission("return_invoice"), returnSale);

// Purchases & inventory (sections 10, 11)
router.get("/purchases", requirePermission("view_purchases"), listPurchases);
router.get("/purchases/:id", requirePermission("view_purchases"), getPurchase);
router.post("/purchases", requirePermission("create_purchases"), createPurchase);
router.post("/purchases/:id/return", requirePermission("create_purchases"), returnPurchase);
router.post("/inventory/adjust", requirePermission("edit_inventory"), adjustStock);
router.get("/inventory/movements", requirePermission("view_inventory"), listMovements);

// Finance (sections 14, 24)
router.get("/expenses", requirePermission("view_expenses"), listExpenses);
router.post("/expenses", requirePermission("create_expenses"), createExpense);
router.patch("/expenses/:id", requirePermission("create_expenses"), updateExpense);
router.delete("/expenses/:id", requirePermission("create_expenses"), deleteExpense);
router.post("/payments", requirePermission("manage_customers"), createPayment);
router.post("/cash-sessions/open", requirePermission("create_sales"), openCashSession);
router.post("/cash-sessions/:id/close", requirePermission("create_sales"), closeCashSession);
router.get("/cash-sessions", requirePermission("close_cash_session"), listCashSessions);
router.get("/cash-sessions/current", requirePermission("create_sales"), getCurrentCashSession);

// Reports (section 23)
router.get("/reports/sales", requirePermission("view_reports"), salesReport);
router.get("/reports/purchases", requirePermission("view_reports"), purchasesReport);
router.get("/reports/tax-declaration", requirePermission("view_reports"), taxDeclarationReport);
router.get("/reports/profit", requirePermission("view_reports"), profitReport);
router.get("/reports/expenses", requirePermission("view_reports"), expensesReport);
router.get("/reports/inventory-valuation", requirePermission("view_reports"), inventoryValuationReport);
router.get("/reports/low-stock", requirePermission("view_reports"), lowStockReport);
router.get("/reports/top-products", requirePermission("view_reports"), topProductsReport);
router.get("/reports/cancelled-invoices", requirePermission("view_reports"), cancelledInvoicesReport);

// Audit log & notifications (sections 19, 33)
router.get("/audit-log", requirePermission("view_audit_log"), listAuditLog);
router.get("/notifications", listNotifications);
router.post("/notifications/:id/read", markNotificationRead);

// Files (section 22, 25)
router.post("/files", uploadFile);
router.get("/files/:id/url", getFileUrl);

// Offline sync (section 27)
router.post("/sync", processSyncBatch);
router.get("/sync/queue", listSyncQueue);

export default router;

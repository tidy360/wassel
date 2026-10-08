import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { LangProvider } from "./i18n";
import Layout from "./components/Layout";
import { RequireAuth, RequireSuperAdmin, RequirePlatformUser, RequireStoreUser } from "./components/Guards";
import LoginPage from "./pages/LoginPage";
import PosPage from "./pages/pos/PosPage";
import MerchantDashboardPage from "./pages/merchant/MerchantDashboardPage";
import ProductsPage from "./pages/merchant/ProductsPage";
import ProductFormPage from "./pages/merchant/ProductFormPage";
import CatalogMetaPage from "./pages/merchant/CatalogMetaPage";
import SuppliersPage from "./pages/merchant/SuppliersPage";
import ExpensesPage from "./pages/merchant/ExpensesPage";
import SupplierStatementPage from "./pages/merchant/SupplierStatementPage";
import SalesPage from "./pages/merchant/SalesPage";
import SaleDetailPage from "./pages/merchant/SaleDetailPage";
import CustomersPage from "./pages/merchant/CustomersPage";
import CustomerStatementPage from "./pages/merchant/CustomerStatementPage";
import ReportsPage from "./pages/merchant/ReportsPage";
import StoreSettingsPage from "./pages/merchant/StoreSettingsPage";
import UsersPage from "./pages/merchant/UsersPage";
import CashSessionPage from "./pages/merchant/CashSessionPage";
import AuditLogPage from "./pages/merchant/AuditLogPage";
import ManufacturingPage from "./pages/merchant/ManufacturingPage";
import PricingPage from "./pages/merchant/PricingPage";
import StoresPage from "./pages/merchant/StoresPage";
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import AdminTenantsPage from "./pages/admin/AdminTenantsPage";
import AdminCreateTenantPage from "./pages/admin/AdminCreateTenantPage";
import AdminPlansPage from "./pages/admin/AdminPlansPage";
import AdminSuperAdminsPage from "./pages/admin/AdminSuperAdminsPage";
import AdminPlatformUsersPage from "./pages/admin/AdminPlatformUsersPage";
import SalesRepsPage from "./pages/admin/SalesRepsPage";
import SalesRepDetailPage from "./pages/admin/SalesRepDetailPage";
import SalesRepMonthlyReportPage from "./pages/admin/SalesRepMonthlyReportPage";
import SalesSupervisorsPage from "./pages/admin/SalesSupervisorsPage";
import FinancialDashboardPage from "./pages/admin/FinancialDashboardPage";
import AccountPage from "./pages/AccountPage";
import SupportTicketsPage from "./pages/merchant/SupportTicketsPage";
import AdminSupportTicketsPage from "./pages/admin/AdminSupportTicketsPage";

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route path="/account" element={<AccountPage />} />

                {/* Store/merchant area */}
                <Route element={<RequireStoreUser />}>
                  <Route path="/" element={<MerchantDashboardPage />} />
                  <Route path="/pos" element={<PosPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/products/new" element={<ProductFormPage />} />
                  <Route path="/products/:id/edit" element={<ProductFormPage />} />
                  <Route path="/catalog" element={<CatalogMetaPage />} />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                  <Route path="/expenses" element={<ExpensesPage />} />
                  <Route path="/suppliers/:id" element={<SupplierStatementPage />} />
                  <Route path="/sales" element={<SalesPage />} />
                  <Route path="/sales/:id" element={<SaleDetailPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/customers/:id" element={<CustomerStatementPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/settings" element={<StoreSettingsPage />} />
                  <Route path="/stores" element={<StoresPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/cash-session" element={<CashSessionPage />} />
                  <Route path="/audit-log" element={<AuditLogPage />} />
                  <Route path="/manufacturing" element={<ManufacturingPage />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/support-tickets" element={<SupportTicketsPage />} />
                  <Route path="/support-tickets/:id" element={<SupportTicketsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>

                {/* Platform Super Admin area */}
                <Route element={<RequirePlatformUser />}>
                  <Route path="/admin" element={<AdminDashboardPage />} />
                  <Route path="/admin/tenants" element={<AdminTenantsPage />} />
                  <Route path="/admin/financials" element={<FinancialDashboardPage />} />
                  <Route path="/admin/sales-reps-report" element={<SalesRepMonthlyReportPage />} />
                  <Route path="/admin/support" element={<AdminSupportTicketsPage />} />

                  {/* Super-Admin-only pages within the platform area — sales rep management,
                      plan/pricing management, and platform account administration are
                      never delegated to Accountant/Customer Service (spec section 8). */}
                  <Route element={<RequireSuperAdmin />}>
                    <Route path="/admin/tenants/new" element={<AdminCreateTenantPage />} />
                    <Route path="/admin/plans" element={<AdminPlansPage />} />
                    <Route path="/admin/super-admins" element={<AdminSuperAdminsPage />} />
                    <Route path="/admin/platform-users" element={<AdminPlatformUsersPage />} />
                    <Route path="/admin/sales-reps" element={<SalesRepsPage />} />
                    <Route path="/admin/sales-reps/:id" element={<SalesRepDetailPage />} />
                    <Route path="/admin/sales-supervisors" element={<SalesSupervisorsPage />} />
                  </Route>
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </LangProvider>
  );
}

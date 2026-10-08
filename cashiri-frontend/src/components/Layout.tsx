import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../i18n";
import NotificationsBell from "./NotificationsBell";
import ImpersonationBanner from "./ImpersonationBanner";

const storeNav = [
  { to: "/", label: "dashboard" as const, icon: "📊" },
  { to: "/pos", label: "pos" as const, icon: "🧾" },
  { to: "/products", label: "products" as const, icon: "📦" },
  { to: "/sales", label: "sales" as const, icon: "💵" },
  { to: "/suppliers", label: "suppliers" as const, icon: "🚚" },
  { to: "/expenses", label: "expenses" as const, icon: "💸" },
  { to: "/customers", label: "customers" as const, icon: "👥" },
  { to: "/reports", label: "reports" as const, icon: "📈" },
  { to: "/cash-session", label: "cashSession" as const, icon: "💰" },
  { to: "/audit-log", label: "auditLog" as const, icon: "📜" },
  { to: "/manufacturing", label: "manufacturing" as const, icon: "🏭" },
  { to: "/users", label: "users" as const, icon: "🧑‍💼" },
  { to: "/settings", label: "settings" as const, icon: "⚙️" },
  { to: "/account", label: "account" as const, icon: "👤" },
  { to: "/support-tickets", label: "support" as const, icon: "🛟" },
];

const cashierNav = [
  { to: "/pos", label: "pos" as const, icon: "🧾" },
  { to: "/customers", label: "customers" as const, icon: "👥" },
  { to: "/suppliers", label: "suppliers" as const, icon: "🚚" },
  { to: "/expenses", label: "expenses" as const, icon: "💸" },
];

const storeStaffNav = [
  { to: "/products", label: "products" as const, icon: "📦" },
  { to: "/suppliers", label: "suppliers" as const, icon: "🚚" },
  { to: "/account", label: "account" as const, icon: "👤" },
];

const fullAdminNav = [
  { to: "/admin", label: "dashboard" as const, icon: "📊" },
  { to: "/admin/tenants", label: "tenants" as const, icon: "🏬" },
  { to: "/admin/sales-reps", label: "salesReps" as const, icon: "🧑‍💼" },
  { to: "/admin/sales-supervisors", label: "salesSupervisors" as const, icon: "🧭" },
  { to: "/admin/sales-reps-report", label: "reports" as const, icon: "📈" },
  { to: "/admin/plans", label: "subscriptions" as const, icon: "💳" },
  { to: "/admin/tenants/new", label: "tenants" as const, icon: "➕" },
  { to: "/admin/super-admins", label: "users" as const, icon: "🔑" },
  { to: "/admin/platform-users", label: "users" as const, icon: "🧑‍💻" },
  { to: "/admin/support", label: "support" as const, icon: "🛟" },
  { to: "/account", label: "account" as const, icon: "👤" },
];

/** Accountant: read-only financial visibility, no tenant/subscription management, no sales-rep admin (spec section 8). */
const accountantNav = [
  { to: "/admin/financials", label: "subscriptions" as const, icon: "💰" },
  { to: "/admin/sales-reps-report", label: "reports" as const, icon: "📈" },
  { to: "/account", label: "account" as const, icon: "👤" },
];

/** Customer Service: subscription actions only, zero financial visibility (spec section 8). */
const customerServiceNav = [
  { to: "/admin/tenants", label: "tenants" as const, icon: "🏬" },
  { to: "/admin/support", label: "support" as const, icon: "🛟" },
  { to: "/account", label: "account" as const, icon: "👤" },
];

function getAdminNav(roles: string[]) {
  if (roles.includes("ACCOUNTANT")) return accountantNav;
  if (roles.includes("CUSTOMER_SERVICE")) return customerServiceNav;
  return fullAdminNav; // literal Super Admin
}

function getStoreNav(roles: string[]) {
  if (roles.includes("STORE_STAFF")) return storeStaffNav;
  return roles.includes("CASHIER") ? cashierNav : storeNav;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, lang, toggle } = useLang();
  const isPlatformUser = Boolean(user?.isSuperAdmin || (!user?.tenantId && !user?.storeId));
  const nav = isPlatformUser ? getAdminNav(user?.roles ?? []) : [
    ...getStoreNav(user?.roles ?? []),
    ...(user?.allStoresAccess ? [{ to: "/stores", label: "stores" as const, icon: "🏬" }] : []),
  ];

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-nile-900 text-paper p-4">
        <div className="text-xl font-black mb-8 px-2">{t("appName")}</div>
        <nav className="flex-1 space-y-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/" || item.to === "/admin"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? "bg-nile-700 text-paper" : "text-nile-100 hover:bg-nile-700/50"
                }`
              }
            >
              <span>{item.icon}</span>
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
        </nav>
        <button onClick={toggle} className="text-nile-100 text-sm px-3 py-2 text-start">{lang === "ar" ? "English" : "العربية"}</button>
        <button onClick={logout} className="text-nile-100 text-sm px-3 py-2 text-start hover:text-white">{t("logout")}</button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <ImpersonationBanner />
        <header className="md:hidden flex items-center justify-between p-3 border-b border-nile-100 bg-white">
          <span className="font-black text-nile-900">{t("appName")}</span>
          <div className="flex items-center gap-3">
            <NotificationsBell admin={isPlatformUser} />
            <button onClick={logout} className="text-sm text-nile-700">{t("logout")}</button>
          </div>
        </header>

        <div className="hidden md:flex justify-end p-3 border-b border-nile-100 bg-white">
          <NotificationsBell admin={isPlatformUser} />
        </div>

        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto">
          <Outlet />
        </main>

        {/* Bottom nav — mobile, big tap targets (spec section 38) */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-nile-100 flex justify-around py-2">
          {nav.slice(0, 5).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/" || item.to === "/admin"}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 px-2 py-1 text-xs ${isActive ? "text-nile-700 font-semibold" : "text-ink/60"}`}
            >
              <span className="text-lg">{item.icon}</span>
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

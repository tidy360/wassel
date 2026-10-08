import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireAuth() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireSuperAdmin() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isSuperAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Super Admin OR platform staff (Accountant / Customer Service — spec section 8). */
export function RequirePlatformUser() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.isSuperAdmin || (!user.tenantId && !user.storeId)) return <Outlet />;
  return <Navigate to="/" replace />;
}

export function RequireStoreUser() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.isSuperAdmin || (!user.tenantId && !user.storeId)) {
    // Customer Service has no financial-dashboard permission — send them
    // straight to Tenants, the one screen their role can always load.
    const landing = user.roles?.includes("CUSTOMER_SERVICE") ? "/admin/tenants" : "/admin";
    return <Navigate to={landing} replace />;
  }
  return <Outlet />;
}

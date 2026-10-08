import { createContext, useContext, useState, type ReactNode } from "react";
import { api } from "../api/client";

interface AuthUser {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  tenantId: string | null;
  storeId: string | null;
  allStoresAccess?: boolean;
  isSuperAdmin: boolean;
  roles: string[];
  impersonating?: boolean;
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

interface ImpersonateResponse {
  token: string;
  user: AuthUser;
  warning: string;
}

const AuthContext = createContext<{
  user: AuthUser | null;
  login: (identifier: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  impersonate: (tenantId: string, storeId: string, targetUserId: string) => Promise<string>;
  switchBack: () => void;
  isImpersonating: boolean;
}>({ user: null, login: async () => {}, logout: () => {}, impersonate: async () => "", switchBack: () => {}, isImpersonating: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem("cashiri_user") || sessionStorage.getItem("cashiri_user");
    return raw ? JSON.parse(raw) : null;
  });

  async function login(identifier: string, password: string, rememberMe = false) {
    const res = await api.post<LoginResponse>("/api/auth/login", { identifier, password, rememberMe });
    const storage = rememberMe ? localStorage : sessionStorage;
    localStorage.removeItem("cashiri_token");
    localStorage.removeItem("cashiri_user");
    sessionStorage.removeItem("cashiri_token");
    sessionStorage.removeItem("cashiri_user");
    storage.setItem("cashiri_token", res.token);
    storage.setItem("cashiri_user", JSON.stringify(res.user));
    setUser(res.user);
  }

  function logout() {
    localStorage.removeItem("cashiri_token");
    localStorage.removeItem("cashiri_user");
    sessionStorage.removeItem("cashiri_token");
    sessionStorage.removeItem("cashiri_user");
    localStorage.removeItem("cashiri_admin_token");
    localStorage.removeItem("cashiri_admin_user");
    setUser(null);
  }

  /** Super Admin "Login as Store" (spec section 32) — stashes the admin's own session so switchBack() can restore it. */
  async function impersonate(tenantId: string, storeId: string, targetUserId: string) {
    const currentStorage = localStorage.getItem("cashiri_token") ? localStorage : sessionStorage;
    const currentToken = currentStorage.getItem("cashiri_token");
    const currentUser = currentStorage.getItem("cashiri_user");
    if (currentToken && currentUser) {
      localStorage.setItem("cashiri_admin_token", currentToken);
      localStorage.setItem("cashiri_admin_user", currentUser);
      localStorage.setItem("cashiri_admin_storage", currentStorage === localStorage ? "local" : "session");
    }

    const res = await api.post<ImpersonateResponse>(`/api/admin/tenants/${tenantId}/stores/${storeId}/impersonate`, { targetUserId });
    localStorage.setItem("cashiri_token", res.token);
    localStorage.setItem("cashiri_user", JSON.stringify(res.user));
    setUser(res.user);
    return res.warning;
  }

  function switchBack() {
    const adminToken = localStorage.getItem("cashiri_admin_token");
    const adminUser = localStorage.getItem("cashiri_admin_user");
    if (!adminToken || !adminUser) return;
    const adminStorage = localStorage.getItem("cashiri_admin_storage") === "session" ? sessionStorage : localStorage;
    localStorage.removeItem("cashiri_token");
    localStorage.removeItem("cashiri_user");
    sessionStorage.removeItem("cashiri_token");
    sessionStorage.removeItem("cashiri_user");
    adminStorage.setItem("cashiri_token", adminToken);
    adminStorage.setItem("cashiri_user", adminUser);
    localStorage.removeItem("cashiri_admin_token");
    localStorage.removeItem("cashiri_admin_user");
    localStorage.removeItem("cashiri_admin_storage");
    setUser(JSON.parse(adminUser));
  }

  const isImpersonating = Boolean(user?.impersonating);

  return <AuthContext.Provider value={{ user, login, logout, impersonate, switchBack, isImpersonating }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

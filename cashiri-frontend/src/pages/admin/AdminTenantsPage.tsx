import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useLang } from "../../i18n";

interface Tenant {
  id: string; businessName: string; status: string; storeCount: number; activeStoreCount: number;
  currentPlan: string | null; maxBranches: number | null; subscriptionEndsAt: string | null; salesRep: { id: string; name: string } | null;
}
interface Store { id: string; name: string; isActive: boolean }
interface StoreUser { id: string; name: string; email: string; roles: string[] }
interface Plan { id: string; name: string; price: string }

const statusLabel: Record<string, string> = { active: "نشط", suspended: "موقوف", trial: "تجريبي", expired: "منتهي" };
const FREE_MONTH_OPTIONS = [0, 1, 2, 3];
const PAID_MONTH_OPTIONS = [1, 3, 6, 12];
type TenantFilter = "all" | "active" | "suspended" | "expiring7" | "expiring30";

const tenantFilters: { value: TenantFilter; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "active", label: "النشط" },
  { value: "suspended", label: "الموقوف" },
  { value: "expiring7", label: "ينتهي خلال 7 أيام" },
  { value: "expiring30", label: "ينتهي خلال 30 يوم" },
];

function getRemainingSubscription(endDate: string | null) {
  if (!endDate) return { date: "—", remaining: "—" };

  const [year, month, day] = endDate.slice(0, 10).split("-").map(Number);
  const end = new Date(year, month - 1, day);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const date = new Intl.DateTimeFormat("ar", { year: "numeric", month: "long", day: "numeric" }).format(end);

  if (end < start) return { date, remaining: "منتهي" };

  let months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  let anchor = new Date(start.getFullYear(), start.getMonth() + months, start.getDate());
  if (anchor > end) {
    months -= 1;
    anchor = new Date(start.getFullYear(), start.getMonth() + months, start.getDate());
  }
  const days = Math.floor((end.getTime() - anchor.getTime()) / 86400000);
  const parts = [];
  if (months) parts.push(`${months} ${months === 1 ? "شهر" : "أشهر"}`);
  if (days) parts.push(`${days} ${days === 1 ? "يوم" : "أيام"}`);
  return { date, remaining: parts.length ? `متبقي ${parts.join(" و ")}` : "ينتهي اليوم" };
}

function getRemainingMonths(endDate: string | null) {
  if (!endDate) return 0;
  const today = new Date();
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(end.getTime()) || end < today) return 0;
  return Math.max(1, (end.getFullYear() - today.getFullYear()) * 12 + end.getMonth() - today.getMonth());
}

export default function AdminTenantsPage() {
  const { t } = useLang();
  const { user, impersonate } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [storeUsers, setStoreUsers] = useState<StoreUser[]>([]);
  const [tenantFilter, setTenantFilter] = useState<TenantFilter>("all");
  const [storeForm, setStoreForm] = useState({ name: "", adminName: "", adminUsername: "", adminEmail: "", adminPassword: "" });
  const [createdStoreCredentials, setCreatedStoreCredentials] = useState<{ username: string; password?: string } | null>(null);
  const [subForm, setSubForm] = useState({ planId: "", paidMonths: 1, freeMonths: 0, paymentMethod: "cash" });
  const canDeleteTenant = Boolean(user?.isSuperAdmin || !(user?.roles ?? []).includes("CUSTOMER_SERVICE"));
  const canAddStore = (tenant: Tenant) => tenant.maxBranches == null || tenant.storeCount < tenant.maxBranches;

  function reloadTenants() {
    api.get<{ data: Tenant[] }>("/api/admin/tenants?pageSize=100").then((r) => setTenants(r.data));
  }

  useEffect(() => {
    reloadTenants();
    api.get<Plan[]>("/api/admin/plans").then(setPlans);
  }, []);

  async function assignSubscription(tenantId: string) {
    if (!subForm.planId) {
      push("اختر الباقة أولاً", "error");
      return;
    }
    try {
      await api.post(`/api/admin/tenants/${tenantId}/subscriptions`, subForm);
      push(`تم التجديد — إجمالي مدة الصلاحية: ${subForm.paidMonths + subForm.freeMonths} شهر ✅`, "success");
      setSubForm({ planId: "", paidMonths: 1, freeMonths: 0, paymentMethod: "cash" });
      reloadTenants();
    } catch (err: any) {
      push(err.message || "تعذر تجديد الاشتراك", "error");
    }
  }

  async function deleteTenant(tenantId: string, businessName: string) {
    if (!window.confirm(`سيتم حذف التاجر "${businessName}" وكل بياناته نهائيًا. هل تريد المتابعة؟`)) return;
    if (!window.confirm("تأكيد أخير: لا يمكن التراجع عن الحذف. هل أنت متأكد؟")) return;
    try {
      await api.delete(`/api/admin/tenants/${tenantId}`);
      push("تم حذف التاجر وبياناته", "success");
      setExpandedTenant(null);
      reloadTenants();
    } catch (err: any) {
      push(err.message || "تعذر حذف التاجر", "error");
    }
  }

  async function expandTenant(tenantId: string) {
    if (expandedTenant === tenantId) { setExpandedTenant(null); return; }
    setExpandedTenant(tenantId);
    setExpandedStore(null);
    setStores(await api.get<Store[]>(`/api/admin/tenants/${tenantId}/stores`));
  }

  async function expandStore(tenantId: string, storeId: string) {
    if (expandedStore === storeId) { setExpandedStore(null); return; }
    setExpandedStore(storeId);
    setStoreUsers(await api.get<StoreUser[]>(`/api/admin/tenants/${tenantId}/stores/${storeId}/users`));
  }

  async function createStore(tenantId: string) {
    if (!storeForm.name.trim() || !storeForm.adminName.trim() || !storeForm.adminUsername.trim()) {
      push("أدخل اسم الفرع واسم مسؤول الفرع واسم المستخدم", "error");
      return;
    }
    try {
      const response = await api.post<{ adminUser: { username: string }; generatedPassword?: string }>(`/api/admin/tenants/${tenantId}/stores`, {
        name: storeForm.name.trim(),
        adminName: storeForm.adminName.trim(),
        adminUsername: storeForm.adminUsername.trim(),
        adminEmail: storeForm.adminEmail.trim() || undefined,
        adminPassword: storeForm.adminPassword || undefined,
        currency: "SDG",
      });
      setCreatedStoreCredentials({ username: response.adminUser.username, password: response.generatedPassword });
      setStoreForm({ name: "", adminName: "", adminUsername: "", adminEmail: "", adminPassword: "" });
      setStores(await api.get<Store[]>(`/api/admin/tenants/${tenantId}/stores`));
      reloadTenants();
      push("تمت إضافة الفرع", "success");
    } catch (err: any) {
      push(err.message || "تعذر إضافة الفرع", "error");
    }
  }

  async function doImpersonate(tenantId: string, storeId: string, targetUserId: string) {
    await impersonate(tenantId, storeId, targetUserId);
    navigate("/");
  }

  async function removeStore(tenantId: string, storeId: string, storeName: string) {
    if (!window.confirm(`سيتم حذف الفرع "${storeName}" وكل بياناته. هل تريد المتابعة؟`)) return;
    if (!window.confirm("تأكيد أخير: لا يمكن التراجع عن حذف الفرع. هل أنت متأكد؟")) return;
    try {
      await api.delete(`/api/admin/stores/${storeId}`);
      setExpandedStore(null);
      setStores(await api.get<Store[]>(`/api/admin/tenants/${tenantId}/stores`));
      reloadTenants();
      push("تم حذف الفرع", "success");
    } catch (err: any) {
      push(err.message || "تعذر حذف الفرع", "error");
    }
  }

  function matchesFilter(tenant: Tenant) {
    if (tenantFilter === "all") return true;
    if (tenantFilter === "active" || tenantFilter === "suspended") return tenant.status === tenantFilter;
    if (!tenant.subscriptionEndsAt) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(`${tenant.subscriptionEndsAt.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(endDate.getTime()) || endDate < today) return false;
    const days = tenantFilter === "expiring7" ? 7 : 30;
    const limit = new Date(today);
    limit.setDate(limit.getDate() + days);
    return endDate <= limit;
  }

  const filteredTenants = tenants.filter(matchesFilter);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{t("tenants")}</h1>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="فلترة التجار">
        {tenantFilters.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={tenantFilter === option.value}
            onClick={() => setTenantFilter(option.value)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${tenantFilter === option.value ? "border-nile-700 bg-nile-700 text-white" : "border-nile-100 bg-white text-nile-900 hover:bg-nile-50"}`}
          >
            {option.label}
          </button>
        ))}
        <span className="text-sm text-ink/60">{filteredTenants.length} تاجر</span>
      </div>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr>
              <th className="text-start p-3">التاجر</th>
              <th className="text-start p-3">الحالة</th>
              <th className="text-start p-3">المتاجر</th>
              <th className="text-start p-3">الباقة</th>
              <th className="text-center p-3">نهاية الاشتراك</th>
              <th className="text-start p-3">المندوب</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredTenants.map((tn) => {
              const selectedPlan = plans.find((plan) => plan.id === subForm.planId);
              const currentPlan = plans.find((plan) => plan.name === tn.currentPlan);
              const upgradeMonths = getRemainingMonths(tn.subscriptionEndsAt);
              const isUpgrade = Boolean(selectedPlan && currentPlan && Number(selectedPlan.price) > Number(currentPlan.price) && upgradeMonths > 0);
              const displayedAmount = isUpgrade
                ? (Number(selectedPlan!.price) - Number(currentPlan!.price)) * upgradeMonths
                : selectedPlan ? Number(selectedPlan.price) * subForm.paidMonths : null;
              return <>
                <tr key={tn.id} className="border-t border-nile-50">
                  <td className="p-3 font-medium">{tn.businessName}</td>
                  <td className="p-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${tn.status === "active" ? "bg-nile-100 text-nile-900" : tn.status === "suspended" ? "bg-danger/10 text-danger" : "bg-gold-500/10 text-gold-600"}`}>
                      {statusLabel[tn.status] ?? tn.status}
                    </span>
                  </td>
                  <td className="num p-3">{tn.activeStoreCount}/{tn.storeCount}</td>
                  <td className="p-3">{tn.currentPlan ?? "—"}</td>
                  <td className="p-3 text-center text-ink/60">
                    {(() => {
                      const subscription = getRemainingSubscription(tn.subscriptionEndsAt);
                      return <><div>{subscription.date}</div><div className="text-xs mt-1">{subscription.remaining}</div></>;
                    })()}
                  </td>
                  <td className="p-3 text-ink/70">{tn.salesRep?.name ?? "—"}</td>
                  <td className="p-3">
                    <button onClick={() => expandTenant(tn.id)} className="text-nile-700 text-xs underline">التفاصيل</button>
                  </td>
                </tr>
                {expandedTenant === tn.id && (
                  <tr key={`${tn.id}-stores`} className="bg-nile-50/50">
                    <td colSpan={7} className="p-3">
                      <div className="space-y-3">
                        {/* Duration-based subscription renewal (spec section 1) */}
                        <div className="bg-white rounded border border-nile-100 p-3 space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium">الباقة الحالية:</span>
                            <span className="rounded-md bg-nile-50 px-2 py-1 font-bold text-nile-900">{tn.currentPlan ?? "لا يوجد اشتراك"}</span>
                          </div>
                          <span className="text-sm font-medium">تجديد الاشتراك:</span>
                          <div className="flex items-center gap-2 flex-wrap">
                            <select value={subForm.planId} onChange={(e) => setSubForm({ ...subForm, planId: e.target.value })} className="rounded-md border border-nile-100 px-2 py-1 text-sm">
                              <option value="">اختر الباقة</option>
                              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <select value={subForm.paidMonths} onChange={(e) => setSubForm({ ...subForm, paidMonths: Number(e.target.value) })} className="rounded-md border border-nile-100 px-2 py-1 text-sm">
                              {PAID_MONTH_OPTIONS.map((m) => <option key={m} value={m}>{m} شهر مدفوع</option>)}
                            </select>
                            <select value={subForm.freeMonths} onChange={(e) => setSubForm({ ...subForm, freeMonths: Number(e.target.value) })} className="rounded-md border border-nile-100 px-2 py-1 text-sm">
                              {FREE_MONTH_OPTIONS.map((m) => <option key={m} value={m}>{m === 0 ? "بدون أشهر مجانية" : `${m} شهر مجاني`}</option>)}
                            </select>
                            <span className="rounded-md bg-nile-50 px-3 py-1 text-sm">
                              {isUpgrade ? `فرق الترقية: ${(Number(selectedPlan!.price) - Number(currentPlan!.price)).toLocaleString()} SDG × ${upgradeMonths} شهر | الإجمالي: ${displayedAmount!.toLocaleString()} SDG` : `سعر الشهر: ${selectedPlan?.price ?? "—"} SDG | الإجمالي: ${displayedAmount?.toLocaleString() ?? "—"} SDG`}
                            </span>
                            <select value={subForm.paymentMethod} onChange={(e) => setSubForm({ ...subForm, paymentMethod: e.target.value })} className="rounded-md border border-nile-100 px-2 py-1 text-sm">
                              <option value="cash">كاش</option>
                              <option value="transfer">تحويل بنكي</option>
                            </select>
                            <button onClick={() => assignSubscription(tn.id)} className="rounded bg-gold-500 text-nile-900 px-3 py-1 text-xs font-bold">تأكيد</button>
                          </div>
                          <p className="text-xs text-ink/50">{isUpgrade ? `ترقية فورية حتى نهاية الاشتراك الحالي (${upgradeMonths} شهر تقريبًا)` : `إجمالي مدة الصلاحية = ${subForm.paidMonths + subForm.freeMonths} شهر (يبدأ بعد نهاية الاشتراك الحالي تلقائياً إن وجد)`}</p>
                        </div>

                        {canDeleteTenant && <button onClick={() => deleteTenant(tn.id, tn.businessName)} className="rounded bg-danger text-white px-3 py-1 text-xs font-bold">
                          حذف التاجر نهائيًا
                        </button>}

                        {canAddStore(tn) && <div className="bg-white rounded border border-nile-100 p-3 space-y-2">
                          <h2 className="text-sm font-bold text-nile-900">إضافة فرع جديد</h2>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            <input placeholder="اسم الفرع" value={storeForm.name} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} className="rounded-md border border-nile-100 px-2 py-1 text-sm" />
                            <input placeholder="اسم مسؤول الفرع" value={storeForm.adminName} onChange={(e) => setStoreForm({ ...storeForm, adminName: e.target.value })} className="rounded-md border border-nile-100 px-2 py-1 text-sm" />
                            <input placeholder="اسم المستخدم" value={storeForm.adminUsername} onChange={(e) => setStoreForm({ ...storeForm, adminUsername: e.target.value })} dir="ltr" className="rounded-md border border-nile-100 px-2 py-1 text-sm" />
                            <input placeholder="البريد (اختياري)" value={storeForm.adminEmail} onChange={(e) => setStoreForm({ ...storeForm, adminEmail: e.target.value })} dir="ltr" className="rounded-md border border-nile-100 px-2 py-1 text-sm" />
                            <input placeholder="كلمة المرور (اختياري، 8 أحرف)" value={storeForm.adminPassword} onChange={(e) => setStoreForm({ ...storeForm, adminPassword: e.target.value })} type="password" dir="ltr" className="rounded-md border border-nile-100 px-2 py-1 text-sm" />
                            <button onClick={() => createStore(tn.id)} className="rounded bg-gold-500 text-nile-900 px-3 py-1 text-sm font-bold">إضافة الفرع</button>
                          </div>
                          {createdStoreCredentials && <p className="rounded bg-nile-50 p-2 text-xs">اسم المستخدم: <span dir="ltr" className="font-mono">{createdStoreCredentials.username}</span>{createdStoreCredentials.password && <> | كلمة المرور المؤقتة: <span dir="ltr" className="font-mono">{createdStoreCredentials.password}</span></>}</p>}
                        </div>}

                        {stores.map((st) => (
                          <div key={st.id} className="bg-white rounded border border-nile-100 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <button onClick={() => expandStore(tn.id, st.id)} className="font-medium text-sm">
                                🏪 {st.name} {expandedStore === st.id ? "▲" : "▼"}
                              </button>
                              {canDeleteTenant && <button onClick={() => removeStore(tn.id, st.id, st.name)} className="text-xs text-danger underline">حذف الفرع</button>}
                            </div>
                            {expandedStore === st.id && (
                              <div className="mt-2 space-y-1">
                                {storeUsers.map((u) => (
                                  <div key={u.id} className="flex items-center justify-between text-xs border-t border-nile-50 pt-1">
                                    <span>{u.name} ({u.roles.join(", ")}) — <span dir="ltr">{u.email}</span></span>
                                    <button onClick={() => doImpersonate(tn.id, st.id, u.id)} className="rounded bg-gold-500 text-nile-900 px-2 py-0.5 font-bold">
                                      الدخول كهذا المستخدم
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

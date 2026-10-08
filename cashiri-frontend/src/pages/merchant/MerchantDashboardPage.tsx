import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../i18n";

interface DashboardData {
  salesTotal: string;
  taxTotal: string;
  paymentsReceived: string;
  purchasesTotal: string;
  purchasesPaid: string;
  expensesTotal: string;
  netTotal: string;
  installmentTotal: string;
  installmentRemaining: string;
  installmentsDue: string;
  installmentsOverdue: string;
  invoiceCount: number;
  customerCount: number;
  supplierCount: number;
  productCount: number;
  lowStockCount: number;
  outOfStockCount: number;
}

function StatCard({ label, value, accent, warn }: { label: string; value: string | number; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? "bg-nile-700 text-paper border-nile-700" : warn ? "bg-gold-500/10 border-gold-500" : "bg-white border-nile-100"}`}>
      <div className={`text-sm ${accent ? "text-nile-100" : "text-ink/60"}`}>{label}</div>
      <div className="num text-2xl font-black mt-1">{value}</div>
    </div>
  );
}

interface Store {
  id: string;
  name: string;
  isMain: boolean;
  isActive: boolean;
}

export default function MerchantDashboardPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [branchMetrics, setBranchMetrics] = useState<Record<string, DashboardData>>({});
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.get<DashboardData>(`/api/store/dashboard?from=${from}&to=${to}`).then(setData).catch((err: any) => setError(err.message || "تعذر تحميل لوحة التحكم")).finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => {
    if (!user?.allStoresAccess) {
      setStores([]);
      setBranchMetrics({});
      setSelectedStoreId(null);
      return;
    }

    api.get<Store[]>("/api/store/stores")
      .then((response) => {
        const safeStores = Array.isArray(response) ? response : [];
        setStores(safeStores);
        if (!selectedStoreId) {
          const defaultStore = safeStores.find((store) => store.id === user.storeId) ?? safeStores[0] ?? null;
          setSelectedStoreId(defaultStore?.id ?? null);
        }
      })
      .catch(() => setStores([]));
  }, [user?.allStoresAccess, user?.storeId]);

  useEffect(() => {
    if (!user?.allStoresAccess || stores.length === 0) {
      setBranchMetrics({});
      return;
    }

    let cancelled = false;

    async function loadBranchMetrics() {
      const results = await Promise.all(
        stores.map(async (store) => {
          const metrics = await api.get<DashboardData>(`/api/store/dashboard?from=${from}&to=${to}&storeId=${store.id}`);
          return [store.id, metrics] as const;
        })
      );

      if (!cancelled) {
        setBranchMetrics(Object.fromEntries(results));
      }
    }

    loadBranchMetrics().catch(() => {
      if (!cancelled) setBranchMetrics({});
    });

    return () => {
      cancelled = true;
    };
  }, [user?.allStoresAccess, stores, from, to]);

  const money = (value: string | number) => `${Number(value).toLocaleString()} SDG`;
  const branchCards = stores.length > 0 ? stores : user?.allStoresAccess ? [{ id: user.storeId ?? "current", name: user.name || "الفرع الحالي", isMain: true, isActive: true }] : [];
  const selectedStore = branchCards.find((store) => store.id === selectedStoreId) ?? branchCards[0] ?? null;
  const selectedData = selectedStore && user?.allStoresAccess ? (branchMetrics[selectedStore.id] ?? data) : data;
  const displayData = selectedData ?? data;
  const branchOptions = branchCards.map((store) => ({
    ...store,
    profit: user?.allStoresAccess ? Number(branchMetrics[store.id]?.netTotal ?? 0) : Number(data?.netTotal ?? 0),
  }));
  const branchProfit = selectedData ? Number(selectedData.netTotal) : 0;

  if (loading && !data) return <p className="text-ink/50">جارٍ تحميل لوحة التحكم...</p>;
  if (error && !data) return <div className="rounded-md bg-danger/10 p-4 text-danger">{error}<button onClick={() => window.location.reload()} className="ms-3 underline">إعادة المحاولة</button></div>;
  if (!displayData) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black text-nile-900">{t("dashboard")}</h1>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-nile-100 bg-white p-3">
        <label className="text-sm">من<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded border border-nile-100 px-2 py-1" /></label>
        <label className="text-sm">إلى<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded border border-nile-100 px-2 py-1" /></label>
        <div className="flex gap-2"><button onClick={() => { const date = new Date(); setTo(date.toISOString().slice(0, 10)); setFrom(date.toISOString().slice(0, 10)); }} className="rounded border border-nile-100 px-3 py-1 text-sm">اليوم</button><button onClick={() => { const date = new Date(); setTo(date.toISOString().slice(0, 10)); setFrom(new Date(date.getTime() - 7 * 86400000).toISOString().slice(0, 10)); }} className="rounded border border-nile-100 px-3 py-1 text-sm">7 أيام</button><button onClick={() => { const date = new Date(); setTo(date.toISOString().slice(0, 10)); setFrom(new Date(date.getTime() - 30 * 86400000).toISOString().slice(0, 10)); }} className="rounded border border-nile-100 px-3 py-1 text-sm">30 يوم</button></div>
      </div>

      {branchOptions.length > 1 && (
        <div className="rounded-lg border border-nile-100 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {branchOptions.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => setSelectedStoreId(store.id)}
                className={`rounded-md border px-3 py-2 text-sm font-bold transition ${selectedStore?.id === store.id ? "border-nile-700 bg-nile-700 text-paper" : "border-nile-100 bg-white text-nile-900"}`}
              >
                {store.name}
                {store.isMain && <span className="ms-1 rounded bg-gold-500/20 px-1.5 py-0.5 text-[10px] text-nile-900">رئيسي</span>}
              </button>
            ))}
          </div>

          {selectedStore && selectedData && (
            <div className="rounded-lg border border-gold-300 bg-gold-500/10 p-4">
              <div className="text-xs text-ink/60">اسم الفرع</div>
              <div className="mt-1 text-2xl font-black text-nile-900">{selectedStore.name}</div>
              <div className="mt-3 text-xs text-ink/60">ربح الفرع</div>
              <div className="mt-1 text-3xl font-black text-nile-900">{money(branchProfit)}</div>
            </div>
          )}
        </div>
      )}

      {branchOptions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {branchOptions.map((store) => (
            <div key={store.id} className={`rounded-lg border p-4 ${selectedStore?.id === store.id ? "border-nile-700 bg-nile-50" : "bg-white border-nile-100"}`}>
              <div className="text-sm text-ink/60">اسم الفرع</div>
              <div className="mt-1 text-xl font-black text-nile-900">{store.name}</div>
              {store.isMain && <div className="mt-2 text-[10px] font-bold text-nile-700">الفرع الرئيسي</div>}
              <div className="mt-3 text-sm text-ink/60">ربح الفرع</div>
              <div className="mt-1 text-2xl font-black">{money(store.profit)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="إجمالي المبيعات" value={money(displayData.salesTotal)} accent />
        <StatCard label="المبالغ المحصلة" value={money(displayData.paymentsReceived)} />
        <StatCard label="المشتريات" value={money(displayData.purchasesTotal)} />
        <StatCard label="المصروفات" value={money(displayData.expensesTotal)} />
        <StatCard label="الضريبة" value={money(displayData.taxTotal)} />
        <StatCard label="صافي المبيعات بعد المصروفات والضريبة" value={money(displayData.netTotal)} />
        <StatCard label="المبالغ المتبقية بالتقسيط" value={money(displayData.installmentRemaining)} warn />
        <StatCard label="أقساط مستحقة" value={money(displayData.installmentsDue)} warn />
        <StatCard label="أقساط متأخرة" value={money(displayData.installmentsOverdue)} warn />
        <StatCard label="الفواتير" value={displayData.invoiceCount} />
        <StatCard label={t("customers")} value={displayData.customerCount} />
        <StatCard label={t("suppliers")} value={displayData.supplierCount} />
        <StatCard label={t("products")} value={displayData.productCount} />
        <StatCard label={t("lowStock")} value={displayData.lowStockCount} />
        <StatCard label="نفد من المخزون" value={displayData.outOfStockCount} />
      </div>
    </div>
  );
}

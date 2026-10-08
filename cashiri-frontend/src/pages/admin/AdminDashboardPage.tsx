import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useLang } from "../../i18n";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface AdminDashboardData {
  totalTenants: number;
  activeStores: number;
  suspendedStores: number;
  subscriptionsExpiringIn7Days: number;
  subscriptionsExpiringIn30Days: number;
  expiredSubscriptions: number;
  totalProducts: number;
  totalCustomers: number;
  totalSalesReps: number;
  totalSuppliers: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  totalSubscriptionRevenue: string | number;
  totalRepCommissions: string | number;
  totalSupervisorCommissions: string | number;
  netSubscriptionProfit: string | number;
  subscriptionTrend: { month: string; count: number; revenue: number }[];
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return localDateString(date);
}

function StatCard({ label, value, warn, onClick }: { label: string; value: number; warn?: boolean; onClick?: () => void }) {
  const interactive = Boolean(onClick);
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => { if (interactive && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick?.(); } }}
      className={`rounded-lg border p-4 ${warn && value > 0 ? "bg-gold-500/10 border-gold-500" : "bg-white border-nile-100"} ${interactive ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gold-500" : ""}`}
    >
      <div className="text-sm text-ink/60">{label}</div>
      <div className="num text-2xl font-black mt-1 text-nile-900">{value}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(() => localDateString(new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1)));
  const [to, setTo] = useState(() => localDateString(new Date()));

  function setPreset(fromDate: string) {
    setFrom(fromDate);
    setTo(localDateString(new Date()));
  }

  useEffect(() => {
    api.get<AdminDashboardData>(`/api/admin/dashboard?from=${from}&to=${to}`).then((result) => { setData(result); setError(null); }).catch((err) => setError(err.message || "تعذر تحميل البيانات"));
  }, [from, to]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-ink/50">...</p>;

  const trend = data.subscriptionTrend.map((point) => ({
    ...point,
    label: (() => {
      const [year, month] = point.month.split("-").map(Number);
      const date = new Date(year, month - 1, 1);
      return Number.isNaN(date.getTime()) ? point.month : new Intl.DateTimeFormat("ar", { month: "short" }).format(date);
    })(),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black text-nile-900">{t("platformKpis")}</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={t("tenants")} value={data.totalTenants} onClick={() => navigate("/admin/tenants")} />
        <StatCard label="متاجر نشطة" value={data.activeStores} onClick={() => navigate("/admin/tenants")} />
        <StatCard label="متاجر موقوفة" value={data.suspendedStores} onClick={() => navigate("/admin/tenants")} />
        <StatCard label="اشتراكات منتهية" value={data.expiredSubscriptions} warn onClick={() => navigate("/admin/tenants")} />
        <StatCard label="تنتهي خلال 7 أيام" value={data.subscriptionsExpiringIn7Days} warn onClick={() => navigate("/admin/tenants")} />
        <StatCard label="تنتهي خلال 30 يوم" value={data.subscriptionsExpiringIn30Days} warn onClick={() => navigate("/admin/tenants")} />
        <StatCard label="المناديب" value={data.totalSalesReps} onClick={() => navigate("/admin/sales-reps")} />
      </div>
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-nile-900">الاشتراكات والإيرادات</h2>
            <p className="text-sm text-ink/60 mt-1">ملخص الاشتراكات خلال آخر 12 شهرًا</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ["أمس", localDateString(new Date(Date.now() - 86400000))],
            ["آخر 3 أشهر", monthsAgo(3)],
            ["آخر 6 أشهر", monthsAgo(6)],
            ["آخر سنة", monthsAgo(12)],
            ["آخر 5 سنوات", monthsAgo(60)],
          ].map(([label, value]) => (
            <button key={label} type="button" onClick={() => setPreset(value)} className="rounded-md border border-nile-100 bg-white px-3 py-1.5 text-xs text-nile-900 hover:bg-nile-50">
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="إجمالي الاشتراكات" value={data.totalSubscriptions} />
          <StatCard label="الاشتراكات النشطة" value={data.activeSubscriptions} />
          <div className="rounded-lg border border-nile-100 bg-white p-4"><div className="text-sm text-ink/60">إيرادات الاشتراكات</div><div className="num text-2xl font-black mt-1 text-nile-900">{Number(data.totalSubscriptionRevenue).toLocaleString()} SDG</div></div>
          <div className="rounded-lg border border-nile-100 bg-white p-4"><div className="text-sm text-ink/60">عمولات المندوبين</div><div className="num text-2xl font-black mt-1 text-nile-900">{Number(data.totalRepCommissions).toLocaleString()} SDG</div></div>
          <div className="rounded-lg border border-nile-100 bg-white p-4"><div className="text-sm text-ink/60">صافي ربح الاشتراكات</div><div className="num text-2xl font-black mt-1 text-nile-900">{Number(data.netSubscriptionProfit).toLocaleString()} SDG</div></div>
        </div>
        <div className="rounded-lg border border-nile-100 bg-white p-4">
          <div className="h-72" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 10, right: 12, left: 12, bottom: 0 }}>
                <defs><linearGradient id="subscriptionRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0a4642" stopOpacity={0.3} /><stop offset="95%" stopColor="#0a4642" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#cfe4e2" />
                <XAxis dataKey="label" tick={{ fill: "#1c231f", fontSize: 12 }} />
                <YAxis tick={{ fill: "#1c231f", fontSize: 12 }} tickFormatter={(value) => `${Number(value) / 1000}k`} />
                <Tooltip formatter={(value: number, name: string) => [name === "revenue" ? `${Number(value).toLocaleString()} SDG` : value, name === "revenue" ? "الإيرادات" : "الاشتراكات"]} />
                <Area type="monotone" dataKey="revenue" stroke="#0a4642" strokeWidth={3} fill="url(#subscriptionRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
}

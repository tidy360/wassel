import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface FinancialData {
  totalSubscriptions: number; activeSubscriptions: number; expiredSubscriptions: number;
  subscriptionsExpiringIn7Days: number; subscriptionsExpiringIn30Days: number;
  totalPaymentsInRange: string; deferredPaymentsOutstanding: string;
  installmentsDue: string; installmentsOverdue: string;
  totalRepCommissions: string; repCommissionsPaid: string; repCommissionsRemaining: string;
}

function Card({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${warn ? "bg-danger/10 border-danger" : "bg-white border-nile-100"}`}>
      <div className="text-sm text-ink/60">{label}</div>
      <div className="num text-xl font-black mt-1 text-nile-900">{value}</div>
    </div>
  );
}

export default function FinancialDashboardPage() {
  const [data, setData] = useState<FinancialData | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    api.get<FinancialData>(`/api/admin/financial-dashboard?from=${from}&to=${to}`).then(setData);
  }, [from, to]);

  if (!data) return <p className="text-ink/50">...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-nile-900">اللوحة المالية</h1>
      <div className="flex items-center gap-2">
        <label className="text-sm">من <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-nile-100 px-2 py-1 num" /></label>
        <label className="text-sm">إلى <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-nile-100 px-2 py-1 num" /></label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="إجمالي الاشتراكات" value={data.totalSubscriptions} />
        <Card label="الاشتراكات النشطة" value={data.activeSubscriptions} />
        <Card label="الاشتراكات المنتهية" value={data.expiredSubscriptions} warn />
        <Card label="تنتهي خلال 7 أيام" value={data.subscriptionsExpiringIn7Days} warn />
        <Card label="تنتهي خلال 30 يوم" value={data.subscriptionsExpiringIn30Days} />
        <Card label="إجمالي المدفوعات (الفترة)" value={`${Number(data.totalPaymentsInRange).toLocaleString()} SDG`} />
        <Card label="مدفوعات آجلة متبقية" value={`${Number(data.deferredPaymentsOutstanding).toLocaleString()} SDG`} />
        <Card label="أقساط مستحقة" value={`${Number(data.installmentsDue).toLocaleString()} SDG`} />
        <Card label="أقساط متأخرة" value={`${Number(data.installmentsOverdue).toLocaleString()} SDG`} warn />
        <Card label="إجمالي عمولات المناديب" value={`${Number(data.totalRepCommissions).toLocaleString()} SDG`} />
        <Card label="عمولات مدفوعة" value={`${Number(data.repCommissionsPaid).toLocaleString()} SDG`} />
        <Card label="عمولات متبقية" value={`${Number(data.repCommissionsRemaining).toLocaleString()} SDG`} />
      </div>
    </div>
  );
}

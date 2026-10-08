import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface ProfitReport { revenue: string; cost: string; grossProfit: string; expenses: string; netProfit: string }
interface TaxDeclaration { salesCount: number; taxableSales: number; outputTax: number; purchasesCount: number; inputTax: number; netTaxDue: number }

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function downloadExcel(path: string, from: string, to: string) {
  const token = localStorage.getItem("cashiri_token");
  const url = `${API_URL}${path}?format=xlsx&from=${from}&to=${to}`;
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.blob())
    .then((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "report.xlsx";
      link.click();
    });
}

export default function ReportsPage() {
  const { t } = useLang();
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [taxDeclaration, setTaxDeclaration] = useState<TaxDeclaration | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    api.get<ProfitReport>(`/api/store/reports/profit?from=${from}&to=${to}`).then(setProfit);
    api.get<TaxDeclaration>(`/api/store/reports/tax-declaration?from=${from}&to=${to}`).then(setTaxDeclaration);
  }, [from, to]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black text-nile-900">{t("reports")}</h1>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-sm">من <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-nile-100 px-2 py-1 num" /></label>
        <label className="text-sm">إلى <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-nile-100 px-2 py-1 num" /></label>
      </div>

      {profit && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {([
            ["الإيرادات", profit.revenue],
            ["التكلفة", profit.cost],
            ["إجمالي الربح", profit.grossProfit],
            ["المصروفات", profit.expenses],
            ["صافي الربح", profit.netProfit],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-nile-100 bg-white p-4">
              <div className="text-sm text-ink/60">{label}</div>
              <div className="num text-xl font-black mt-1 text-nile-900">{Number(value).toLocaleString()} SDG</div>
            </div>
          ))}
        </div>
      )}

      {taxDeclaration && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            ["المبيعات الخاضعة", taxDeclaration.taxableSales],
            ["ضريبة المبيعات", taxDeclaration.outputTax],
            ["ضريبة المشتريات", taxDeclaration.inputTax],
            ["صافي الضريبة المستحقة", taxDeclaration.netTaxDue],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-gold-500 bg-gold-500/10 p-4">
              <div className="text-sm text-ink/60">{label}</div>
              <div className="num text-xl font-black mt-1 text-nile-900">{Number(value).toLocaleString()} SDG</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-2">
        <h2 className="font-bold">تنزيل تقارير Excel</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => downloadExcel("/api/store/reports/sales", from, to)} className="rounded-md bg-nile-700 text-paper px-4 py-2 text-sm">تقرير المبيعات</button>
          <button onClick={() => downloadExcel("/api/store/reports/purchases", from, to)} className="rounded-md bg-nile-700 text-paper px-4 py-2 text-sm">تقرير المشتريات</button>
          <button onClick={() => downloadExcel("/api/store/reports/tax-declaration", from, to)} className="rounded-md bg-gold-500 text-nile-900 px-4 py-2 text-sm font-bold">الإقرار الضريبي</button>
          <button onClick={() => downloadExcel("/api/store/reports/inventory-valuation", from, to)} className="rounded-md bg-nile-700 text-paper px-4 py-2 text-sm">تقييم المخزون</button>
        </div>
      </div>

      <ReportTables from={from} to={to} />
    </div>
  );
}

function ReportTables({ from, to }: { from: string; to: string }) {
  const [tab, setTab] = useState<"expenses" | "top" | "lowstock" | "cancelled">("lowstock");
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    const endpoint = {
      expenses: `/api/store/reports/expenses?from=${from}&to=${to}`,
      top: `/api/store/reports/top-products?from=${from}&to=${to}`,
      lowstock: `/api/store/reports/low-stock`,
      cancelled: `/api/store/reports/cancelled-invoices?from=${from}&to=${to}`,
    }[tab];
    setRows([]);
    api.get<any>(endpoint).then((r) => {
      if (!cancelled) setRows(tab === "expenses" ? r.expenses : r);
    });
    return () => { cancelled = true; };
  }, [tab, from, to]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 border-b border-nile-100">
        {([
          ["expenses", "المصروفات"], ["top", "أكثر المنتجات مبيعاً"], ["lowstock", "مخزون منخفض"], ["cancelled", "فواتير ملغاة"],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === key ? "border-nile-700 text-nile-900" : "border-transparent text-ink/50"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {tab === "expenses" && rows.map((r: any) => (
              <tr key={r.id} className="border-t border-nile-50"><td className="p-3">{r.name}</td><td className="p-3 text-ink/60">{r.category ?? "—"}</td><td className="num p-3">{Number(r.amount).toLocaleString()} SDG</td></tr>
            ))}
            {tab === "top" && rows.map((r: any) => (
              <tr key={r.productId} className="border-t border-nile-50"><td className="p-3">{r.name}</td><td className="num p-3">{r.qtySold}</td><td className="num p-3">{Number(r.revenue).toLocaleString()} SDG</td></tr>
            ))}
            {tab === "lowstock" && rows.map((r: any) => (
              <tr key={r.id} className="border-t border-nile-50"><td className="p-3">{r.name}</td><td className="num p-3 text-danger">{r.current_stock}</td><td className="num p-3 text-ink/60">حد أدنى: {r.min_stock}</td></tr>
            ))}
            {tab === "cancelled" && rows.map((r: any) => (
              <tr key={r.id} className="border-t border-nile-50"><td className="num p-3">#{r.invoiceNumber}</td><td className="p-3 text-ink/60">{r.cancelReason ?? "—"}</td><td className="num p-3">{Number(r.total).toLocaleString()} SDG</td></tr>
            ))}
            {rows.length === 0 && <tr><td className="p-4 text-center text-ink/40" colSpan={3}>لا توجد بيانات</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

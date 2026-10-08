import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface RepRow { salesRepId: string; salesRepName: string; tenantCount: number; operationCount: number; totalPayments: string; totalCommission: string; totalPaid: string; totalRemaining: string }

export default function SalesRepMonthlyReportPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState<RepRow[]>([]);

  useEffect(() => {
    api.get<{ reps: RepRow[] }>(`/api/admin/sales-reps/reports/monthly?month=${month}&year=${year}`).then((r) => setRows(r.reps));
  }, [month, year]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-nile-900">تقرير دخل المناديب الشهري</h1>
      <div className="flex gap-2">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-md border border-nile-100 px-3 py-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="num w-28 rounded-md border border-nile-100 px-3 py-2" />
      </div>

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr>
              <th className="text-start p-3">المندوب</th><th className="text-start p-3">التجار</th><th className="text-start p-3">العمليات</th>
              <th className="text-start p-3">إجمالي المبيعات</th><th className="text-start p-3">إجمالي العمولة</th><th className="text-start p-3">المدفوع</th><th className="text-start p-3">المتبقي</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.salesRepId} className="border-t border-nile-50">
                <td className="p-3 font-medium">{r.salesRepName}</td>
                <td className="num p-3">{r.tenantCount}</td>
                <td className="num p-3">{r.operationCount}</td>
                <td className="num p-3">{Number(r.totalPayments).toLocaleString()}</td>
                <td className="num p-3">{Number(r.totalCommission).toLocaleString()}</td>
                <td className="num p-3">{Number(r.totalPaid).toLocaleString()}</td>
                <td className="num p-3 text-gold-600 font-bold">{Number(r.totalRemaining).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

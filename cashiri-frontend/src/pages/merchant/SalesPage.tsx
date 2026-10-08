import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface Sale { id: string; invoiceNumber: number; total: string; status: string; createdAt: string }

const statusLabel: Record<string, string> = {
  completed: "مكتملة", cancelled: "ملغاة", returned: "مسترجعة", partially_returned: "استرجاع جزئي",
};

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function SalesPage() {
  const { t } = useLang();
  const [sales, setSales] = useState<Sale[]>([]);

  useEffect(() => {
    api.get<{ data: Sale[] }>("/api/store/sales?pageSize=50").then((r) => setSales(r.data));
  }, []);

  function openPdf(id: string) {
    // The PDF endpoint requires the same Bearer auth as everything else, so
    // a plain <a href> won't carry it — fetch it as a blob and open that instead.
    const token = localStorage.getItem("cashiri_token");
    fetch(`${API_URL}/api/store/sales/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => window.open(URL.createObjectURL(blob), "_blank"));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{t("sales")}</h1>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr>
              <th className="text-start p-3">رقم الفاتورة</th>
              <th className="text-start p-3">الإجمالي</th>
              <th className="text-start p-3">الحالة</th>
              <th className="text-start p-3">التاريخ</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className="border-t border-nile-50">
                <td className="num p-3"><Link to={`/sales/${s.id}`} className="text-nile-700 underline">#{s.invoiceNumber}</Link></td>
                <td className="num p-3">{Number(s.total).toLocaleString()} SDG</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${s.status === "completed" ? "bg-nile-100 text-nile-900" : s.status === "cancelled" ? "bg-danger/10 text-danger" : "bg-gold-500/10 text-gold-600"}`}>
                    {statusLabel[s.status] ?? s.status}
                  </span>
                </td>
                <td className="num p-3 text-ink/60">{new Date(s.createdAt).toLocaleString("ar-SD")}</td>
                <td className="p-3">
                  <button onClick={() => openPdf(s.id)} className="text-nile-700 text-xs underline">طباعة / PDF</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

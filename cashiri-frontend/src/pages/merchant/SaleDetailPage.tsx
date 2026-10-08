import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface SaleItem { id: string; productId: string; quantity: string; unitPrice: string; total: string }
interface ReturnItem { saleItemId: string; quantity: string; total: string }
interface SaleReturn { id: string; total: string; createdAt: string; items: ReturnItem[] }
interface Sale { id: string; invoiceNumber: number; status: string; total: string; items: SaleItem[]; returns: SaleReturn[]; financials: { netTotal: string; totalCost: string; netProfit: string } }

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { push } = useToast();
  const [sale, setSale] = useState<Sale | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelForm, setShowCancelForm] = useState(false);

  function returnedQuantity(saleItemId: string) {
    return sale?.returns.reduce((sum, entry) => sum + entry.items.filter((item) => item.saleItemId === saleItemId).reduce((itemSum, item) => itemSum + Number(item.quantity), 0), 0) ?? 0;
  }

  const returnedTotal = sale?.returns.reduce((sum, entry) => sum + Number(entry.total), 0) ?? 0;

  function reload() {
    api.get<Sale>(`/api/store/sales/${id}`).then(setSale);
  }
  useEffect(reload, [id]);

  async function submitReturn() {
    if (!sale) return;
    const items = Object.entries(returnQty).filter(([, qty]) => qty > 0).map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    if (items.length === 0) { push("حدد كمية واحدة على الأقل للاسترجاع", "error"); return; }
    try {
      await api.post(`/api/store/sales/${sale.id}/return`, { items });
      push("تم تسجيل الاسترجاع ✅", "success");
      setReturnQty({});
      reload();
    } catch (err: any) {
      push(err.message || "تعذر تنفيذ الاسترجاع", "error");
    }
  }

  async function submitCancel() {
    if (!sale || !cancelReason.trim()) { push("سبب الإلغاء مطلوب", "error"); return; }
    try {
      await api.post(`/api/store/sales/${sale.id}/cancel`, { reason: cancelReason });
      push("تم إلغاء الفاتورة", "success");
      setShowCancelForm(false);
      reload();
    } catch (err: any) {
      push(err.message || "تعذر الإلغاء", "error");
    }
  }

  if (!sale) return <p className="text-ink/50">...</p>;

  return (
    <div className="max-w-xl space-y-4">
      <button onClick={() => navigate("/sales")} className="text-sm text-nile-700 underline">← رجوع للمبيعات</button>
      <h1 className="text-2xl font-black text-nile-900">فاتورة #{sale.invoiceNumber}</h1>
      <p className="num text-lg">{Number(sale.financials.netTotal).toLocaleString()} SDG — <span className="text-sm">{sale.status}</span></p>
      {returnedTotal > 0 && <p className="num text-sm text-nile-700">الإجمالي الأصلي: {Number(sale.total).toLocaleString()} SDG — المسترجع: {returnedTotal.toLocaleString()} SDG</p>}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md bg-nile-50 px-3 py-2">التكلفة بعد الاسترجاع: <span className="num font-bold">{Number(sale.financials.totalCost).toLocaleString()} SDG</span></div>
        <div className="rounded-md bg-gold-500/20 px-3 py-2">صافي الربح: <span className="num font-bold">{Number(sale.financials.netProfit).toLocaleString()} SDG</span></div>
      </div>

      <div className="bg-white border border-nile-100 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">الصنف</th><th className="text-start p-3">سعر الوحدة</th><th className="text-start p-3">المباعة</th><th className="text-start p-3">المسترجعة</th><th className="text-start p-3">المتبقي للاسترجاع</th><th className="text-start p-3">استرجاع جديد</th></tr>
          </thead>
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.id} className="border-t border-nile-50">
                <td className="p-3 font-mono text-xs">{item.productId}</td>
                <td className="num p-3">{Number(item.unitPrice).toLocaleString()} SDG</td>
                <td className="num p-3">{item.quantity}</td>
                <td className="num p-3">{returnedQuantity(item.id)}</td>
                <td className="num p-3">{Math.max(0, Number(item.quantity) - returnedQuantity(item.id))}</td>
                <td className="p-3">
                  {sale.status !== "cancelled" && (
                    <input
                      type="number" min={0} max={Math.max(0, Number(item.quantity) - returnedQuantity(item.id))}
                      value={returnQty[item.id] ?? ""}
                      onChange={(e) => setReturnQty((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))}
                      className="num w-20 rounded-md border border-nile-100 px-2 py-1"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sale.status !== "cancelled" && (
        <div className="flex gap-2">
          <button onClick={submitReturn} className="rounded-md bg-gold-500 text-nile-900 font-bold px-4 py-2">تسجيل استرجاع</button>
          <button onClick={() => setShowCancelForm((s) => !s)} className="rounded-md bg-danger/10 text-danger font-bold px-4 py-2">إلغاء الفاتورة</button>
        </div>
      )}

      {sale.returns.length > 0 && (
        <section className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <h2 className="font-bold text-lg">عمليات الاسترجاع</h2>
          {sale.returns.map((entry, index) => (
            <div key={entry.id} className="rounded-md border border-nile-100 bg-nile-50 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span>العملية #{sale.returns.length - index} — {new Date(entry.createdAt).toLocaleString("ar-SD")}</span>
                <span className="num font-bold">قيمة الاسترجاع: {Number(entry.total).toLocaleString()} SDG</span>
              </div>
              <div className="mt-2 space-y-1 text-ink/70">
                {entry.items.map((item) => {
                  const saleItem = sale.items.find((line) => line.id === item.saleItemId);
                  return <div key={item.saleItemId} className="flex justify-between"><span>{saleItem?.productId ?? item.saleItemId}</span><span className="num">كمية: {Number(item.quantity).toLocaleString()} — {Number(item.total).toLocaleString()} SDG</span></div>;
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {showCancelForm && (
        <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-2">
          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="سبب الإلغاء" className="w-full rounded-md border border-nile-100 px-3 py-2" />
          <button onClick={submitCancel} className="rounded-md bg-danger text-white font-bold px-4 py-2">تأكيد الإلغاء</button>
        </div>
      )}
    </div>
  );
}

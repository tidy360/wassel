import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface PurchaseItem { id: string; productId: string; quantity: string; unitPrice: string; total: string }
interface Purchase { id: string; total: string; paidAmount: string; items: PurchaseItem[] }

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { push } = useToast();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});

  function reload() {
    api.get<Purchase>(`/api/store/purchases/${id}`).then(setPurchase);
  }
  useEffect(reload, [id]);

  async function submitReturn() {
    if (!purchase) return;
    const items = Object.entries(returnQty).filter(([, qty]) => qty > 0).map(([purchaseItemId, quantity]) => ({ purchaseItemId, quantity }));
    if (items.length === 0) { push("حدد كمية واحدة على الأقل للاسترجاع", "error"); return; }
    try {
      await api.post(`/api/store/purchases/${purchase.id}/return`, { items });
      push("تم تسجيل استرجاع المشتريات ✅", "success");
      setReturnQty({});
      reload();
    } catch (err: any) {
      push(err.message || "تعذر تنفيذ الاسترجاع", "error");
    }
  }

  if (!purchase) return <p className="text-ink/50">...</p>;

  return (
    <div className="max-w-xl space-y-4">
      <button onClick={() => navigate("/purchases")} className="text-sm text-nile-700 underline">← رجوع للمشتريات</button>
      <h1 className="text-2xl font-black text-nile-900">فاتورة شراء</h1>
      <p className="num text-lg">{Number(purchase.total).toLocaleString()} SDG — مدفوع: {Number(purchase.paidAmount).toLocaleString()} SDG</p>

      <div className="bg-white border border-nile-100 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">الصنف</th><th className="text-start p-3">الكمية المشتراة</th><th className="text-start p-3">استرجاع للمورد</th></tr>
          </thead>
          <tbody>
            {purchase.items.map((item) => (
              <tr key={item.id} className="border-t border-nile-50">
                <td className="p-3 font-mono text-xs">{item.productId}</td>
                <td className="num p-3">{item.quantity}</td>
                <td className="p-3">
                  <input
                    type="number" min={0} max={Number(item.quantity)}
                    value={returnQty[item.id] ?? ""}
                    onChange={(e) => setReturnQty((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))}
                    className="num w-20 rounded-md border border-nile-100 px-2 py-1"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={submitReturn} className="rounded-md bg-gold-500 text-nile-900 font-bold px-4 py-2">تسجيل استرجاع للمورد</button>
    </div>
  );
}

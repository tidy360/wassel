import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface Performance {
  rep: { id: string; name: string; phone: string | null; commissionRate: string };
  tenantCount: number;
  totalCommissions: string;
  totalPaidViaCommissions: string;
  totalRemaining: string;
  totalPayments: string;
}
interface Commission { id: string; tenantId: string; paymentAmount: string; commissionAmount: string; status: string; paidAmount: string; remainingAmount: string; createdAt: string }
interface RepPayment { id: string; amount: string; paymentDate: string; paymentMethod: string | null; referenceNumber: string | null }

export default function SalesRepDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { push } = useToast();
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payments, setPayments] = useState<RepPayment[]>([]);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payForm, setPayForm] = useState({ amount: 0, paymentMethod: "cash", notes: "", referenceNumber: "" });

  function reload() {
    api.get<Performance>(`/api/admin/sales-reps/${id}/performance`).then(setPerformance);
    api.get<{ rep: any; commissions: Commission[]; payments: RepPayment[] }>(`/api/admin/sales-reps/${id}/statement`).then((r) => {
      setCommissions(r.commissions);
      setPayments(r.payments);
    });
  }
  useEffect(reload, [id]);

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/admin/sales-reps/${id}/payments`, payForm);
      push("تم تسجيل الدفعة ✅", "success");
      setShowPayForm(false);
      setPayForm({ amount: 0, paymentMethod: "cash", notes: "", referenceNumber: "" });
      reload();
    } catch (err: any) {
      push(err.message || "تعذر تسجيل الدفعة", "error");
    }
  }

  if (!performance) return <p className="text-ink/50">...</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{performance.rep.name}</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg bg-white border border-nile-100 p-4"><div className="text-sm text-ink/60">التجار</div><div className="num text-xl font-black">{performance.tenantCount}</div></div>
        <div className="rounded-lg bg-nile-700 text-paper p-4"><div className="text-sm text-nile-100">إجمالي العمولات</div><div className="num text-xl font-black">{Number(performance.totalCommissions).toLocaleString()}</div></div>
        <div className="rounded-lg bg-white border border-nile-100 p-4"><div className="text-sm text-ink/60">المدفوع</div><div className="num text-xl font-black">{Number(performance.totalPayments).toLocaleString()}</div></div>
        <div className="rounded-lg bg-gold-500/10 border border-gold-500 p-4"><div className="text-sm text-ink/60">المتبقي</div><div className="num text-xl font-black">{Number(performance.totalRemaining).toLocaleString()}</div></div>
      </div>

      <button onClick={() => setShowPayForm((s) => !s)} className="rounded-md bg-gold-500 text-nile-900 font-bold px-4 py-2">دفع للمندوب</button>

      {showPayForm && (
        <form onSubmit={submitPayment} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <label className="text-sm">المبلغ
            <input required type="number" min={0} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <label className="text-sm">طريقة الدفع
            <select value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1">
              <option value="cash">نقدي</option>
              <option value="transfer">تحويل بنكي</option>
            </select>
          </label>
          <label className="text-sm">رقم مرجعي (اختياري)
            <input value={payForm.referenceNumber} onChange={(e) => setPayForm({ ...payForm, referenceNumber: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <label className="text-sm">ملاحظات
            <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <button type="submit" className="rounded-md bg-nile-700 text-paper font-bold px-6 py-2">تأكيد الدفع</button>
        </form>
      )}

      <h2 className="font-bold text-lg">سجل العمولات</h2>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">التاريخ</th><th className="text-start p-3">قيمة الدفعة</th><th className="text-start p-3">العمولة</th><th className="text-start p-3">الحالة</th></tr></thead>
          <tbody>
            {commissions.map((c) => (
              <tr key={c.id} className="border-t border-nile-50">
                <td className="num p-3 text-ink/60">{new Date(c.createdAt).toLocaleDateString("ar-SD")}</td>
                <td className="num p-3">{Number(c.paymentAmount).toLocaleString()}</td>
                <td className="num p-3">{Number(c.commissionAmount).toLocaleString()}</td>
                <td className="p-3">{c.status === "due" ? "مستحقة" : c.status === "partially_paid" ? "مدفوعة جزئياً" : "مدفوعة بالكامل"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-bold text-lg">سجل المدفوعات للمندوب</h2>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">التاريخ</th><th className="text-start p-3">المبلغ</th><th className="text-start p-3">الطريقة</th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-nile-50">
                <td className="num p-3 text-ink/60">{new Date(p.paymentDate).toLocaleDateString("ar-SD")}</td>
                <td className="num p-3">{Number(p.amount).toLocaleString()}</td>
                <td className="p-3">{p.paymentMethod ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

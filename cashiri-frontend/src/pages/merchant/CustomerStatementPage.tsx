import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";

interface Statement {
  customer: { name: string; balance: string };
  sales: { id: string; invoiceNumber: number; total: string; createdAt: string }[];
  payments: { id: string; amount: string; createdAt: string }[];
  installmentPlans: { id: string; sale: { invoiceNumber: number }; totalAmount: string; downPayment: string; installments: { id: string; installmentNumber: number; dueDate: string; amount: string; paidAmount: string; remainingAmount: string; status: string }[] }[];
}
interface PaymentMethod { id: string; code: string; name: string }

export default function CustomerStatementPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Statement | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Statement>(`/api/store/customers/${id}/statement`).then(setData);
    api.get<PaymentMethod[]>("/api/store/settings/payment-methods").then(setPaymentMethods);
  }, [id]);

  if (!data) return <p className="text-ink/50">...</p>;

  async function payInstallment(installmentId: string, remaining: string, paymentMethodId: string) {
    const amount = Number(remaining);
    setPaymentError(null);
    setPayingId(installmentId);
    try {
      await api.post(`/api/store/customer-installments/${installmentId}/pay`, { amount, paymentMethodId });
      const refreshed = await api.get<Statement>(`/api/store/customers/${id}/statement`);
      setData(refreshed);
    } catch (err: any) {
      setPaymentError(err.message || "تعذر تسجيل الدفعة");
    } finally {
      setPayingId(null);
    }
  }

  function formatDate(value: string) {
    return new Intl.DateTimeFormat("ar", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{data.customer.name}</h1>
      <div className="rounded-lg bg-nile-700 text-paper p-4">
        <div className="text-sm text-nile-100">الرصيد (مديونية)</div>
        <div className="num text-2xl font-black">{Number(data.customer.balance).toLocaleString()} SDG</div>
      </div>

      <h2 className="font-bold text-lg">الفواتير</h2>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">رقم الفاتورة</th><th className="text-start p-3">التاريخ</th><th className="text-start p-3">الإجمالي</th></tr></thead>
          <tbody>
            {data.sales.map((s) => (
              <tr key={s.id} className="border-t border-nile-50">
                <td className="num p-3">#{s.invoiceNumber}</td>
                <td className="num p-3 text-ink/60">{new Date(s.createdAt).toLocaleDateString("ar-SD")}</td>
                <td className="num p-3">{Number(s.total).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.installmentPlans.length > 0 && <>
        <h2 className="font-bold text-lg">جداول التقسيط</h2>
        {data.installmentPlans.map((plan) => <div key={plan.id} className="bg-white border border-nile-100 rounded-lg overflow-x-auto p-3">
          <p className="font-bold mb-2">فاتورة #{plan.sale.invoiceNumber} — الدفعة الأولى: <span className="num">{Number(plan.downPayment).toLocaleString()}</span> — الأشهر المتبقية: <span className="num">{plan.installments.filter((installment) => installment.status !== "paid").length}</span></p>
          <table className="w-full text-sm">
            <thead className="bg-nile-50"><tr><th className="p-2 text-start">القسط</th><th className="p-2 text-start">الاستحقاق</th><th className="p-2 text-start">القيمة</th><th className="p-2 text-start">المتبقي</th><th className="p-2 text-start">الحالة</th><th className="p-2"></th></tr></thead>
            <tbody>{plan.installments.map((installment) => <tr key={installment.id} className="border-t border-nile-50"><td className="p-2">{installment.installmentNumber}</td><td className="p-2">{formatDate(installment.dueDate)}</td><td className="num p-2">{Number(installment.amount).toLocaleString()}</td><td className="num p-2">{Number(installment.remainingAmount).toLocaleString()}</td><td className="p-2">{installment.status === "not_due" ? "لم يستحق" : installment.status === "due" ? "مستحق" : installment.status === "partially_paid" ? "مدفوع جزئيًا" : installment.status === "paid" ? "مدفوع بالكامل" : "متأخر"}</td><td className="p-2">{installment.remainingAmount !== "0" && installment.status !== "paid" && (payingId === installment.id ? <span className="flex items-center gap-1">{paymentMethods.map((method) => <button key={method.id} onClick={() => payInstallment(installment.id, installment.remainingAmount, method.id)} className="rounded bg-gold-500 px-2 py-1 text-xs font-bold">{method.code === "transfer" ? "تحويل" : "كاش"}</button>)}</span> : <button onClick={() => setPayingId(installment.id)} className="rounded bg-gold-500 px-2 py-1 text-xs font-bold">تسجيل دفعة كاملة</button>)}</td></tr>)}</tbody>
          </table>
          {paymentError && <p className="mt-2 text-sm text-danger">{paymentError}</p>}
        </div>)}
      </>}

      <h2 className="font-bold text-lg">المدفوعات</h2>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">التاريخ</th><th className="text-start p-3">المبلغ</th></tr></thead>
          <tbody>
            {data.payments.map((p) => (
              <tr key={p.id} className="border-t border-nile-50">
                <td className="num p-3 text-ink/60">{new Date(p.createdAt).toLocaleDateString("ar-SD")}</td>
                <td className="num p-3">{Number(p.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

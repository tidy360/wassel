import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";

interface Statement {
  supplier: { name: string; balance: string };
  purchases: { id: string; total: string; paidAmount: string; createdAt: string; items: { id: string; productName: string; quantity: string; unitPrice: string; total: string; salePrice: string }[] }[];
  payments: { id: string; amount: string; createdAt: string }[];
}

interface PaymentMethod {
  id: string;
  name: string;
  code: string;
  requiresAttachment: boolean;
}

export default function SupplierStatementPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Statement | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [amount, setAmount] = useState("");
  const [selectedMethodId, setSelectedMethodId] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const [statement, methods] = await Promise.all([
        api.get<Statement>(`/api/store/suppliers/${id}/statement`),
        api.get<PaymentMethod[]>("/api/store/settings/payment-methods"),
      ]);
      setData(statement);
      setPaymentMethods(methods);
      if (methods[0]) setSelectedMethodId(methods[0].id);
    };

    load().catch(() => setPaymentError("تعذر تحميل بيانات المورد"));
  }, [id]);

  async function recordPayment() {
    const parsedAmount = Number(amount);
    const maxAllowed = Math.abs(Number(data?.supplier.balance ?? 0));
    const selectedMethod = paymentMethods.find((method) => method.id === selectedMethodId);

    if (!id || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setPaymentError("أدخل مبلغًا صحيحًا أكبر من صفر");
      return;
    }

    if (parsedAmount > maxAllowed) {
      setPaymentError(`المبلغ لا يمكن أن يتجاوز ${maxAllowed.toLocaleString()} SDG`);
      return;
    }

    if (selectedMethod?.requiresAttachment && !receiptFile) {
      setPaymentError("أرفق إيصال التحويل قبل تسجيل الدفعة");
      return;
    }

    setIsSubmitting(true);
    setPaymentError(null);

    try {
      let attachmentUrl: string | undefined;
      if (selectedMethod?.requiresAttachment && receiptFile) {
        const base64Data = await fileToBase64(receiptFile);
        const uploaded = await api.post<{ signedUrl: string }>("/api/store/files", {
          fileName: receiptFile.name,
          mimeType: receiptFile.type,
          base64Data,
        });
        attachmentUrl = uploaded.signedUrl;
      }

      await api.post("/api/store/payments", {
        partyType: "supplier",
        partyId: id,
        amount: parsedAmount,
        paymentMethodId: selectedMethodId || undefined,
        attachmentUrl,
      });

      setAmount("");
      setReceiptFile(null);
      const refreshed = await api.get<Statement>(`/api/store/suppliers/${id}/statement`);
      setData(refreshed);
    } catch (err: any) {
      setPaymentError(err.message || "تعذر تسجيل الدفعة");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!data) return <p className="text-ink/50">...</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{data.supplier.name}</h1>
      <div className="rounded-lg bg-nile-700 text-paper p-4">
        <div className="text-sm text-nile-100">الرصيد المستحق</div>
        <div className="num text-2xl font-black">{Number(data.supplier.balance).toLocaleString()} SDG</div>
      </div>

      <div className="rounded-lg border border-nile-100 bg-white p-4">
        <h2 className="mb-3 font-bold text-lg">تسجيل دفعة للمورد</h2>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block">المبلغ</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min="0"
              max={Math.abs(Number(data?.supplier.balance ?? 0))}
              step="1"
              placeholder="0"
              className="w-full rounded-md border border-nile-100 px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block">طريقة الدفع</span>
            <select
              value={selectedMethodId}
              onChange={(e) => {
                setSelectedMethodId(e.target.value);
                if (!paymentMethods.find((method) => method.id === e.target.value)?.requiresAttachment) setReceiptFile(null);
              }}
              className="w-full rounded-md border border-nile-100 px-3 py-2"
            >
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>{method.name}</option>
              ))}
            </select>
          </label>
        </div>

        {paymentMethods.find((method) => method.id === selectedMethodId)?.requiresAttachment && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block">إيصال التحويل</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
            <span className="mt-1 block text-xs text-ink/50">يمكن تصوير الإيصال بالكاميرا أو اختياره من الجهاز</span>
          </label>
        )}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={recordPayment}
            disabled={isSubmitting}
            className="rounded-md bg-nile-700 px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
          >
            {isSubmitting ? "جاري الحفظ..." : "تسجيل دفعة"}
          </button>
        </div>

        {paymentError && <p className="mt-3 text-sm text-danger">{paymentError}</p>}
      </div>

      <h2 className="font-bold text-lg">فواتير الشراء</h2>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">التاريخ</th><th className="text-start p-3">الإجمالي</th><th className="text-start p-3">المدفوع</th></tr></thead>
          <tbody>
            {data.purchases.map((p) => (
              <tr key={p.id} className="border-t border-nile-50">
                <td className="num p-3 text-ink/60">{new Date(p.createdAt).toLocaleDateString("ar-SD")}</td>
                <td className="num p-3">{Number(p.total).toLocaleString()}</td>
                <td className="num p-3">{Number(p.paidAmount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-bold text-lg">المنتجات التي وردها المورد</h2>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">التاريخ</th><th className="text-start p-3">المنتج</th><th className="text-start p-3">الكمية</th><th className="text-start p-3">سعر الشراء</th><th className="text-start p-3">سعر البيع</th><th className="text-start p-3">الإجمالي</th></tr></thead>
          <tbody>
            {data.purchases.flatMap((purchase) => purchase.items.map((item) => (
              <tr key={item.id} className="border-t border-nile-50">
                <td className="num p-3 text-ink/60">{new Date(purchase.createdAt).toLocaleDateString("ar-SD")}</td>
                <td className="p-3">{item.productName}</td>
                <td className="num p-3">{Number(item.quantity).toLocaleString()}</td>
                <td className="num p-3">{Number(item.unitPrice).toLocaleString()} SDG</td>
                <td className="num p-3">{Number(item.salePrice).toLocaleString()} SDG</td>
                <td className="num p-3">{Number(item.total).toLocaleString()} SDG</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


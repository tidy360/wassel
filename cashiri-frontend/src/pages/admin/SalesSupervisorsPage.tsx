import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface Supervisor {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  commissionRate: string;
  status: string;
  repCount: number;
}

interface SalesRep {
  id: string;
  name: string;
  status: string;
}

interface Assignment {
  id: string;
  salesRep: SalesRep;
}

interface Dashboard {
  repCount: number;
  commissions: {
    paymentAmount: string | null;
    repCommissionAmount: string | null;
    supervisorCommissionAmount: string | null;
    paidAmount: string | null;
    remainingAmount: string | null;
  };
}

interface Payment {
  id: string;
  amount: string;
  paymentDate: string;
  paymentMethod?: string | null;
  notes?: string | null;
  referenceNumber?: string | null;
}

export default function SalesSupervisorsPage() {
  const { push } = useToast();
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [repId, setRepId] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", commissionRate: 5 });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const getTodayDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const [paymentForm, setPaymentForm] = useState({ amount: "", paymentDate: getTodayDate(), paymentMethod: "cash", notes: "", referenceNumber: "" });

  async function reload() {
    try {
      const [supervisorRows, repRows] = await Promise.all([
        api.get<Supervisor[]>("/api/admin/sales-supervisors"),
        api.get<SalesRep[]>("/api/admin/sales-reps"),
      ]);
      setSupervisors(supervisorRows);
      setReps(repRows.filter((rep) => rep.status === "active"));
    } catch (err: any) {
      push(err.message || "تعذر تحميل المشرفين", "error");
    }
  }

  useEffect(() => { void reload(); }, []);

  async function selectSupervisor(id: string) {
    setSelectedId(id);
    try {
      const [repRows, dashboardData, paymentRows] = await Promise.all([
        api.get<Assignment[]>(`/api/admin/sales-supervisors/${id}/reps`),
        api.get<Dashboard>(`/api/admin/sales-supervisors/${id}/dashboard`),
        api.get<Payment[]>(`/api/admin/sales-supervisors/${id}/payments`),
      ]);
      setAssignments(repRows);
      setDashboard(dashboardData);
      setPayments(paymentRows);
    } catch (err: any) {
      push(err.message || "تعذر تحميل بيانات المشرف", "error");
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/admin/sales-supervisors", form);
      push("تم إضافة المشرف", "success");
      setForm({ name: "", phone: "", email: "", commissionRate: 5 });
      await reload();
    } catch (err: any) {
      push(err.message || "تعذر إضافة المشرف", "error");
    }
  }

  async function toggle(supervisor: Supervisor) {
    try {
      await api.post(`/api/admin/sales-supervisors/${supervisor.id}/${supervisor.status === "active" ? "disable" : "enable"}`);
      push(supervisor.status === "active" ? "تم تعطيل المشرف" : "تم تفعيل المشرف", "success");
      await reload();
    } catch (err: any) {
      push(err.message || "تعذر تحديث الحالة", "error");
    }
  }

  async function assignRep(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !repId) return;
    try {
      await api.post(`/api/admin/sales-supervisors/${selectedId}/reps/${repId}`);
      push("تم ربط المندوب بالمشرف", "success");
      setRepId("");
      await selectSupervisor(selectedId);
      await reload();
    } catch (err: any) {
      push(err.message || "تعذر ربط المندوب", "error");
    }
  }

  async function removeRep(id: string) {
    if (!selectedId) return;
    try {
      await api.delete(`/api/admin/sales-supervisors/${selectedId}/reps/${id}`);
      push("تم إزالة المندوب من المشرف", "success");
      await selectSupervisor(selectedId);
      await reload();
    } catch (err: any) {
      push(err.message || "تعذر إزالة المندوب", "error");
    }
  }

  async function paySupervisor(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;

    if (paymentForm.paymentMethod === "transfer" && !receiptFile) {
      push("يرجى إرفاق صورة إيصال التحويل", "error");
      return;
    }

    try {
      let proofFilePath: string | undefined;
      if (paymentForm.paymentMethod === "transfer" && receiptFile) {
        const base64Data = await fileToBase64(receiptFile);
        const uploaded = await api.post<{ signedUrl: string }>('/api/store/files', {
          fileName: receiptFile.name,
          mimeType: receiptFile.type,
          base64Data,
        });
        proofFilePath = uploaded.signedUrl;
      }

      await api.post(`/api/admin/sales-supervisors/${selectedId}/payments`, {
        amount: Number(paymentForm.amount),
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        notes: paymentForm.notes,
        referenceNumber: paymentForm.referenceNumber,
        proofFilePath,
      });
      push("تم تسجيل دفع المشرف", "success");
      setPaymentForm((current) => ({
        amount: "",
        paymentDate: current.paymentDate || getTodayDate(),
        paymentMethod: "cash",
        notes: "",
        referenceNumber: "",
      }));
      setReceiptFile(null);
      await selectSupervisor(selectedId);
      await reload();
    } catch (err: any) {
      push(err.message || "تعذر تسجيل الدفع", "error");
    }
  }

  const assignedRepIds = new Set(assignments.map((assignment) => assignment.salesRep.id));
  const availableReps = reps.filter((rep) => !assignedRepIds.has(rep.id));
  const formatAmount = (value: string | null | undefined) => Number(value || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2 });
  const generateReferenceNumber = () => `REF-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;

  function fileToBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? "")); reader.onerror = () => reject(new Error("تعذر قراءة الملف")); reader.readAsDataURL(file); }); }

  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-black text-nile-900">مشرفو المناديب</h1>
        <p className="text-sm text-ink/60 mt-1">إدارة المشرفين وربطهم بالمناديب ومتابعة عمولاتهم.</p>
      </div>

      <form onSubmit={create} className="bg-white border border-nile-100 rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input required placeholder="اسم المشرف" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
        <input placeholder="رقم الجوال" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
        <input type="email" placeholder="البريد الإلكتروني" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
        <label className="flex items-center gap-2 rounded-md border border-nile-100 px-3 py-2 text-sm">
          <span>النسبة</span>
          <input type="number" min={0} max={100} value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: Number(e.target.value) })} className="num w-16" />%
        </label>
        <button type="submit" className="rounded-md bg-gold-500 text-nile-900 font-bold py-2">إضافة مشرف</button>
      </form>

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">الاسم</th><th className="text-start p-3">الجوال</th><th className="text-start p-3">النسبة</th><th className="text-start p-3">المناديب</th><th className="text-start p-3">الحالة</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {supervisors.map((supervisor) => (
              <tr key={supervisor.id} className={`border-t border-nile-50 ${selectedId === supervisor.id ? "bg-gold-50" : ""}`}>
                <td className="p-3"><button onClick={() => void selectSupervisor(supervisor.id)} className="text-nile-700 underline font-medium">{supervisor.name}</button></td>
                <td className="p-3 text-ink/60">{supervisor.phone || "—"}</td>
                <td className="num p-3">{supervisor.commissionRate}%</td>
                <td className="num p-3">{supervisor.repCount}</td>
                <td className="p-3"><span className={`rounded px-2 py-0.5 text-xs ${supervisor.status === "active" ? "bg-nile-100 text-nile-900" : "bg-danger/10 text-danger"}`}>{supervisor.status === "active" ? "نشط" : "معطّل"}</span></td>
                <td className="p-3"><button onClick={() => void toggle(supervisor)} className="text-nile-700 text-xs underline">{supervisor.status === "active" ? "تعطيل" : "تفعيل"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!supervisors.length && <p className="p-6 text-center text-ink/50">لا يوجد مشرفون مضافون بعد.</p>}
      </div>

      {selectedId && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
            <h2 className="font-bold text-lg">مناديب المشرف</h2>
            <form onSubmit={assignRep} className="flex gap-2">
              <select required value={repId} onChange={(e) => setRepId(e.target.value)} className="flex-1 rounded-md border border-nile-100 px-3 py-2">
                <option value="">اختر مندوبًا</option>
                {availableReps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
              </select>
              <button type="submit" className="rounded-md bg-nile-700 text-white px-4">ربط</button>
            </form>
            <div className="space-y-2">
              {assignments.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between border-b border-nile-50 py-2">
                  <span>{assignment.salesRep.name}</span>
                  <button onClick={() => void removeRep(assignment.salesRep.id)} className="text-danger text-xs underline">إزالة</button>
                </div>
              ))}
              {!assignments.length && <p className="text-sm text-ink/50">لا يوجد مناديب مرتبطون.</p>}
            </div>
          </div>

          <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-lg">ملخص العمولة</h2>
              <button type="button" onClick={() => { setPaymentForm({ amount: String(Number(dashboard?.commissions.remainingAmount || 0)), paymentDate: getTodayDate(), paymentMethod: "cash", notes: "", referenceNumber: "" }); setReceiptFile(null); }} className="rounded-md bg-gold-500 text-nile-900 font-bold px-3 py-2 text-sm">دفع المشرف</button>
            </div>
            {dashboard && <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-ink/60">إجمالي المدفوعات</span><strong className="block num">{formatAmount(dashboard.commissions.paymentAmount)}</strong></div>
              <div><span className="text-ink/60">عمولة المناديب</span><strong className="block num">{formatAmount(dashboard.commissions.repCommissionAmount)}</strong></div>
              <div><span className="text-ink/60">عمولة المشرف</span><strong className="block num">{formatAmount(dashboard.commissions.supervisorCommissionAmount)}</strong></div>
              <div><span className="text-ink/60">المتبقي</span><strong className="block num">{formatAmount(dashboard.commissions.remainingAmount)}</strong></div>
            </div>}

            <form onSubmit={paySupervisor} className="space-y-3 border-t border-nile-100 pt-4">
              <h3 className="font-bold text-base">تسجيل دفعة المشرف</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input required type="number" min="0" step="0.01" placeholder="المبلغ" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
                <input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
                <select value={paymentForm.paymentMethod} onChange={(e) => {
                  const nextMethod = e.target.value;
                  const nextReference = nextMethod === "transfer" && !paymentForm.referenceNumber ? generateReferenceNumber() : paymentForm.referenceNumber;
                  setPaymentForm({ ...paymentForm, paymentMethod: nextMethod, referenceNumber: nextReference });
                  if (nextMethod !== "transfer") setReceiptFile(null);
                }} className="rounded-md border border-nile-100 px-3 py-2">
                  <option value="cash">كاش</option>
                  <option value="transfer">تحويل بنكي</option>
                </select>
                <input placeholder="رقم المرجع" value={paymentForm.referenceNumber} onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
              </div>
              {paymentForm.paymentMethod === "transfer" && (
                <label className="block text-sm">
                  <span className="mb-1 block">إيصال التحويل</span>
                  <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
                  <span className="mt-1 block text-xs text-ink/50">يمكن تصوير الإيصال أو رفعه من الجهاز</span>
                </label>
              )}
              <textarea rows={2} placeholder="ملاحظات" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
              <button type="submit" className="rounded-md bg-gold-500 text-nile-900 font-bold px-4 py-2">حفظ الدفع</button>
            </form>

            {payments.length > 0 && (
              <div className="border-t border-nile-100 pt-4">
                <h3 className="font-bold text-base mb-2">سجل الدفعات</h3>
                <div className="space-y-2">
                  {payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between rounded-md border border-nile-100 px-3 py-2 text-sm">
                      <div>
                        <div className="font-bold num">{formatAmount(payment.amount)}</div>
                        <div className="text-ink/60">{payment.paymentMethod || "—"} · {payment.referenceNumber || "بدون مرجع"}</div>
                      </div>
                      <div className="text-ink/60">{new Date(payment.paymentDate).toLocaleDateString("ar-SA")}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

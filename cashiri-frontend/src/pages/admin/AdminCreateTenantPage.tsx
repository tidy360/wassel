import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface SalesRep { id: string; name: string; status: string }
interface Plan { id: string; name: string; price: string }
interface Installment { id: string; installmentNumber: number; dueDate: string; amount: string; paidAmount: string; remainingAmount: string; status: string }

type PaymentMethod = "cash" | "transfer";
type PaymentPlanType = "full" | "deferred" | "installment";
type AdjustmentType = "none" | "interest" | "discount";

export default function AdminCreateTenantPage() {
  const { push } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [tenant, setTenant] = useState({ businessName: "", ownerName: "", phone: "", email: "", salesRepId: "" });
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [store, setStore] = useState({ name: "", adminUsername: "", adminEmail: "", adminName: "", currency: "SDG" });
  const [credentials, setCredentials] = useState<{ username: string; email: string | null; generatedPassword?: string } | null>(null);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  // Payment method step (spec sections 9-11)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentPlanType, setPaymentPlanType] = useState<PaymentPlanType>("full");
  const [planId, setPlanId] = useState("");
  const [paidMonths, setPaidMonths] = useState(1);
  const [freeMonths, setFreeMonths] = useState(0);
  const [baseAmount, setBaseAmount] = useState(0);
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("none");
  const [adjustmentValueType, setAdjustmentValueType] = useState<"percent" | "fixed">("percent");
  const [adjustmentValue, setAdjustmentValue] = useState(0);
  const [downPayment, setDownPayment] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [installmentMonths, setInstallmentMonths] = useState(2);
  const [notes, setNotes] = useState("");
  const [documents, setDocuments] = useState<File[]>([]);
  const [documentType, setDocumentType] = useState("id_proof");
  const [installments, setInstallments] = useState<Installment[]>([]);

  useEffect(() => {
    api.get<SalesRep[]>("/api/admin/sales-reps").then(setReps);
    api.get<Plan[]>("/api/admin/plans").then(setPlans);
  }, []);

  const finalAmount =
    adjustmentType === "none" || !adjustmentValue
      ? baseAmount
      : adjustmentType === "interest"
      ? baseAmount + (adjustmentValueType === "percent" ? (baseAmount * adjustmentValue) / 100 : adjustmentValue)
      : Math.max(0, baseAmount - (adjustmentValueType === "percent" ? (baseAmount * adjustmentValue) / 100 : adjustmentValue));

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    try {
      const created = await api.post<{ id: string }>("/api/admin/tenants", { ...tenant, salesRepId: tenant.salesRepId || undefined });
      setTenantId(created.id);
      setStep(2);
    } catch (err: any) {
      push(err.message || "تعذر إنشاء التاجر", "error");
    }
  }

  async function createStore(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    try {
      const res = await api.post<{ adminUser: { username: string; email: string | null }; generatedPassword?: string }>(`/api/admin/tenants/${tenantId}/stores`, store);
      setCredentials({ username: res.adminUser.username, email: res.adminUser.email, generatedPassword: res.generatedPassword });
      setStep(3);
    } catch (err: any) {
      push(err.message || "تعذر إنشاء المتجر", "error");
    }
  }

  async function confirmPayment() {
    if (!tenantId) return;
    try {
      if (paymentPlanType === "full") {
        if (!planId) return push("اختر الباقة أولاً", "error");
        await api.post(`/api/admin/tenants/${tenantId}/subscriptions`, { planId, paidMonths, freeMonths, amount: finalAmount, paymentMethod });
      } else {
        const plan = await api.post<{ installments?: Installment[] }>(`/api/admin/tenants/${tenantId}/payment-plans`, {
          planType: paymentPlanType,
          paymentMethod,
          baseAmount,
          adjustmentType,
          adjustmentValueType: adjustmentType === "none" ? undefined : adjustmentValueType,
          adjustmentValue: adjustmentType === "none" ? undefined : adjustmentValue,
          downPayment,
          dueDate: paymentPlanType === "deferred" ? dueDate : undefined,
          installmentMonths: paymentPlanType === "installment" ? installmentMonths : undefined,
          notes: notes || undefined,
        });
        setInstallments(plan.installments ?? []);
      }

      for (const document of documents) {
        const base64 = await fileToBase64(document);
        await api.post(`/api/admin/tenants/${tenantId}/documents`, {
          documentType,
          fileName: document.name,
          mimeType: document.type,
          base64Data: base64,
        });
      }

      push("تم تسجيل بيانات الدفع ✅", "success");
      setStep(4);
    } catch (err: any) {
      push(err.message || "تعذر تسجيل الدفع", "error");
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-black text-nile-900">تاجر جديد</h1>

      {step === 1 && (
        <form onSubmit={createTenant} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <input required placeholder="اسم النشاط التجاري" value={tenant.businessName} onChange={(e) => setTenant({ ...tenant, businessName: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
          <input placeholder="اسم المالك" value={tenant.ownerName} onChange={(e) => setTenant({ ...tenant, ownerName: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
          <input placeholder="الهاتف" value={tenant.phone} onChange={(e) => setTenant({ ...tenant, phone: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
          <input type="email" placeholder="البريد الإلكتروني" value={tenant.email} onChange={(e) => setTenant({ ...tenant, email: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
          <label className="text-sm block">المندوب الذي أحضر التاجر (اختياري)
            <select value={tenant.salesRepId} onChange={(e) => setTenant({ ...tenant, salesRepId: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1">
              <option value="">بدون مندوب</option>
              {reps.filter((r) => r.status === "active").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2">التالي: إضافة أول متجر</button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={createStore} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <input required placeholder="اسم المتجر" value={store.name} onChange={(e) => setStore({ ...store, name: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
          <input required placeholder="اسم مسؤول المتجر" value={store.adminName} onChange={(e) => setStore({ ...store, adminName: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
          <input required minLength={3} placeholder="اسم مستخدم مسؤول المتجر (لتسجيل الدخول)" value={store.adminUsername} onChange={(e) => setStore({ ...store, adminUsername: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
          <input type="email" placeholder="بريد مسؤول المتجر (اختياري)" value={store.adminEmail} onChange={(e) => setStore({ ...store, adminEmail: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
          <button type="submit" className="rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2">التالي: طريقة الدفع</button>
        </form>
      )}

      {step === 3 && (
        <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <label className="text-sm block">طريقة الدفع
            <div className="flex gap-2 mt-1">
              {([["cash", "كاش"], ["transfer", "تحويل بنكي"]] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setPaymentMethod(v)} className={`flex-1 rounded-md py-2 text-sm font-medium border ${paymentMethod === v ? "bg-nile-700 text-paper border-nile-700" : "border-nile-100"}`}>{label}</button>
              ))}
            </div>
          </label>

          <label className="text-sm block">نوع السداد
            <div className="flex gap-2 mt-1">
              {([["full", "دفع كامل"], ["deferred", "دفع آجل"], ["installment", "تقسيط"]] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setPaymentPlanType(v)} className={`flex-1 rounded-md py-2 text-sm font-medium border ${paymentPlanType === v ? "bg-nile-700 text-paper border-nile-700" : "border-nile-100"}`}>{label}</button>
              ))}
            </div>
          </label>

          {paymentPlanType === "full" && (
            <>
              <select value={planId} onChange={(e) => { const selected = plans.find((plan) => plan.id === e.target.value); setPlanId(e.target.value); setBaseAmount(selected ? Number(selected.price) : 0); }} className="w-full rounded-md border border-nile-100 px-3 py-2">
                <option value="">اختر الباقة</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.price} SDG</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">مدة الاشتراك (أشهر مدفوعة)
                  <select value={paidMonths} onChange={(e) => setPaidMonths(Number(e.target.value))} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1">
                    {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m === 12 ? "سنة" : m}</option>)}
                  </select>
                </label>
                <label className="text-sm">أشهر مجانية
                  <select value={freeMonths} onChange={(e) => setFreeMonths(Number(e.target.value))} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1">
                    {[0, 1, 2, 3].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
            </>
          )}

          {(paymentPlanType === "deferred" || paymentPlanType === "installment") && (
            <>
              <label className="text-sm block">قيمة الاشتراك الأساسية
                <input type="number" min={0} value={baseAmount} onChange={(e) => setBaseAmount(Number(e.target.value))} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
              </label>
              <label className="text-sm block">التعديل على السعر
                <div className="flex gap-2 mt-1">
                  {([["none", "بدون تعديل"], ["interest", "إضافة فائدة"], ["discount", "خصم"]] as const).map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setAdjustmentType(v)} className={`flex-1 rounded-md py-1.5 text-xs font-medium border ${adjustmentType === v ? "bg-nile-700 text-paper border-nile-700" : "border-nile-100"}`}>{label}</button>
                  ))}
                </div>
              </label>
              {adjustmentType !== "none" && (
                <div className="flex gap-2">
                  <select value={adjustmentValueType} onChange={(e) => setAdjustmentValueType(e.target.value as any)} className="rounded-md border border-nile-100 px-2 py-1 text-sm">
                    <option value="percent">نسبة %</option>
                    <option value="fixed">مبلغ ثابت</option>
                  </select>
                  <input type="number" min={0} value={adjustmentValue} onChange={(e) => setAdjustmentValue(Number(e.target.value))} className="num flex-1 rounded-md border border-nile-100 px-2 py-1 text-sm" />
                </div>
              )}
              <div className="rounded-md bg-nile-50 p-3 text-sm num">السعر النهائي بعد التعديل: <span className="font-black text-nile-900">{finalAmount.toLocaleString()} SDG</span></div>

              <label className="text-sm block">الدفعة الأولى
                <input type="number" min={0} max={finalAmount} value={downPayment} onChange={(e) => setDownPayment(Number(e.target.value))} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
              </label>
              <div className="text-sm text-ink/60">المبلغ المتبقي: <span className="num font-bold">{Math.max(0, finalAmount - downPayment).toLocaleString()} SDG</span></div>

              {paymentPlanType === "deferred" && (
                <label className="text-sm block">تاريخ الاستحقاق
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
                </label>
              )}
              {paymentPlanType === "installment" && (
                <label className="text-sm block">خطة السداد
                  <select value={installmentMonths} onChange={(e) => setInstallmentMonths(Number(e.target.value))} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1">
                    {[2, 4, 6, 12].map((m) => <option key={m} value={m}>{m === 12 ? "سنة" : `${m} أشهر`}</option>)}
                  </select>
                </label>
              )}

              {paymentPlanType === "installment" && (
                <div className="rounded-md border border-nile-100 overflow-x-auto">
                  <p className="bg-nile-50 p-2 text-sm font-bold">معاينة جدول الأقساط</p>
                  <table className="w-full text-xs">
                    <thead><tr className="border-t border-nile-100"><th className="p-2 text-start">القسط</th><th className="p-2 text-start">الاستحقاق</th><th className="p-2 text-start">القيمة</th></tr></thead>
                    <tbody>{Array.from({ length: installmentMonths }, (_, index) => {
                      const value = Math.max(0, finalAmount - downPayment) / installmentMonths;
                      const date = new Date();
                      date.setMonth(date.getMonth() + index + 1);
                      return <tr key={index} className="border-t border-nile-50"><td className="p-2">{index + 1}</td><td className="p-2">{date.toLocaleDateString("ar-SD")}</td><td className="num p-2">{value.toLocaleString(undefined, { maximumFractionDigits: 2 })} SDG</td></tr>;
                    })}</tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <label className="text-sm block">ملاحظات
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات الدفع أو الاتفاق" className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" rows={3} />
          </label>

          <div className="space-y-2">
            <label className="text-sm block">مستندات إثبات الهوية (اختياري)
              <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1">
                <option value="id_proof">إثبات الهوية</option>
                <option value="business_license">رخصة النشاط</option>
                <option value="contract">العقد</option>
                <option value="other">مستند آخر</option>
              </select>
              <input type="file" accept="image/*,application/pdf" capture="environment" multiple onChange={(e) => setDocuments(Array.from(e.target.files ?? []))} className="w-full text-sm mt-1" />
            </label>
            {documents.length > 0 && <p className="text-xs text-ink/60">تم اختيار {documents.length} مستند</p>}
          </div>

          <button onClick={confirmPayment} className="w-full rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2">تأكيد</button>
        </div>
      )}

      {step === 4 && credentials && (
        <div className="bg-nile-50 border border-nile-100 rounded-lg p-4 space-y-2">
          <p className="font-bold text-nile-900">تم إنشاء التاجر والمتجر ✅</p>
          <p className="text-sm">اسم المستخدم: <span dir="ltr" className="font-mono">{credentials.username}</span></p>
          {credentials.email && <p className="text-sm">البريد: <span dir="ltr" className="font-mono">{credentials.email}</span></p>}
          {credentials.generatedPassword && (
            <p className="text-sm">
              كلمة المرور المؤقتة: <span dir="ltr" className="font-mono bg-white px-2 py-0.5 rounded">{credentials.generatedPassword}</span>
              <br /><span className="text-danger text-xs">احفظها الآن — لن تظهر مرة أخرى.</span>
            </p>
          )}
          {installments.length > 0 && (
            <div className="pt-3 overflow-x-auto">
              <h2 className="font-bold">جدول الأقساط</h2>
              <table className="w-full text-sm mt-2 bg-white rounded">
                <thead><tr><th className="p-2 text-start">رقم القسط</th><th className="p-2 text-start">تاريخ الاستحقاق</th><th className="p-2 text-start">قيمة القسط</th><th className="p-2 text-start">المدفوع</th><th className="p-2 text-start">المتبقي</th><th className="p-2 text-start">الحالة</th></tr></thead>
                <tbody>{installments.map((installment) => <tr key={installment.id} className="border-t border-nile-50"><td className="p-2">{installment.installmentNumber}</td><td className="p-2">{new Date(installment.dueDate).toLocaleDateString("ar-SD")}</td><td className="num p-2">{Number(installment.amount).toLocaleString()} SDG</td><td className="num p-2">{Number(installment.paidAmount).toLocaleString()} SDG</td><td className="num p-2">{Number(installment.remainingAmount).toLocaleString()} SDG</td><td className="p-2">{installment.status === "not_due" ? "لم يستحق" : installment.status === "due" ? "مستحق" : installment.status === "partially_paid" ? "مدفوع جزئيًا" : installment.status === "paid" ? "مدفوع بالكامل" : "متأخر"}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
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

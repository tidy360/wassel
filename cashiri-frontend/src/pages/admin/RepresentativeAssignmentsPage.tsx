import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

type Assignment = {
  id: string; merchantId: string; representativeId: string; startDate: string; endDate: string;
  durationMonths: number; status: string; daysRemaining: number; percentageCompleted: number;
  storeId?: string | null;
  merchant: { businessName: string }; representative: { name: string };
};
type Option = { id: string; name?: string; businessName?: string };

const durations = [1, 3, 6, 9, 12];
const statusLabels: Record<string, string> = { ACTIVE: "نشط", EXPIRING_SOON: "ينتهي قريبًا", EXPIRED: "منتهي", TERMINATED: "مفصول", SUSPENDED: "معلّق" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

export default function RepresentativeAssignmentsPage({ embedded = false }: { embedded?: boolean }) {
  const { push } = useToast();
  const [rows, setRows] = useState<Assignment[]>([]);
  const [reps, setReps] = useState<Option[]>([]);
  const [merchants, setMerchants] = useState<Option[]>([]);
  const [filters, setFilters] = useState({ status: "", representativeId: "", merchantId: "", search: "", range: "", startDate: "", endDate: "" });
  const [terminationTarget, setTerminationTarget] = useState<Assignment | null>(null);
  const [terminationReason, setTerminationReason] = useState("");
  const [form, setForm] = useState({ merchantId: "", representativeId: "", startDate: new Date().toISOString().slice(0, 10), durationMonths: 12 });

  async function reload() {
    const query = filters.status ? `?status=${filters.status}` : "";
    const assignments = await api.get<Assignment[]>(`/api/admin/representative-assignments${query}`);
    setRows(filters.search ? assignments.filter((row) => `${row.merchant.businessName} ${row.representative.name}`.includes(filters.search)) : assignments);
  }
  useEffect(() => { Promise.all([api.get<Option[]>("/api/admin/sales-reps"), api.get<any>("/api/admin/tenants")]).then(([repRows, tenantResult]) => { setReps(repRows); setMerchants(tenantResult.data ?? []); }); }, []);
  useEffect(() => { reload().catch((error) => push(error.message || "تعذر تحميل الارتباطات", "error")); }, [filters.status, filters.search]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try { await api.post("/api/admin/representative-assignments", form); push("تم إنشاء الارتباط", "success"); await reload(); }
    catch (error: any) { push(error.message || "تعذر إنشاء الارتباط", "error"); }
  }

  async function terminate() {
    if (!terminationTarget || !terminationReason.trim()) return;
    try { await api.post(`/api/admin/representative-assignments/${terminationTarget.id}/terminate`, { terminationReason }); push("تم فصل المندوب", "success"); setTerminationTarget(null); setTerminationReason(""); await reload(); }
    catch (error: any) { push(error.message || "تعذر الفصل", "error"); }
  }

  async function renew(row: Assignment) {
    const durationMonths = Number(window.prompt("مدة التجديد بالأشهر: 1 أو 3 أو 6 أو 9 أو 12", "12"));
    if (![1, 3, 6, 9, 12].includes(durationMonths)) return;
    try {
      await api.post(`/api/admin/representative-assignments/${row.id}/renew`, { durationMonths });
      push("تم تجديد الارتباط بسجل جديد", "success");
      await reload();
    } catch (error: any) { push(error.message || "تعذر تجديد الارتباط", "error"); }
  }

  const filteredRows = rows.filter((row) => {
    const matchesSearch = !filters.search || `${row.merchant.businessName} ${row.representative.name}`.includes(filters.search);
    const matchesRepresentative = !filters.representativeId || row.representativeId === filters.representativeId;
    const matchesMerchant = !filters.merchantId || row.merchantId === filters.merchantId;
    const matchesRange = !filters.range || (filters.range === "expiring7" ? row.daysRemaining > 0 && row.daysRemaining <= 7 : row.daysRemaining > 0 && row.daysRemaining <= 30);
    const start = !filters.startDate || row.startDate.slice(0, 10) >= filters.startDate;
    const end = !filters.endDate || row.endDate.slice(0, 10) <= filters.endDate;
    return matchesSearch && matchesRepresentative && matchesMerchant && matchesRange && start && end;
  });
  const counts = { all: rows.length, active: rows.filter((r) => ["ACTIVE", "EXPIRING_SOON"].includes(r.status)).length, soon: rows.filter((r) => r.daysRemaining <= 30 && r.daysRemaining > 0).length, expired: rows.filter((r) => r.status === "EXPIRED").length, terminated: rows.filter((r) => r.status === "TERMINATED").length };
  return <div className={`${embedded ? "max-w-6xl border-t border-nile-100 pt-6" : "max-w-6xl"} space-y-5`}>
    <div><h2 className={`${embedded ? "text-xl" : "text-2xl"} font-black text-nile-900`}>ارتباطات التجار</h2><p className="text-sm text-ink/60 mt-1">يتم إنشاء الارتباط تلقائيًا عند إنشاء أو تجديد اشتراك التاجر.</p></div>
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{[["الإجمالي", counts.all], ["النشطة", counts.active], ["تنتهي خلال 30 يوم", counts.soon], ["المنتهية", counts.expired], ["المفصولة", counts.terminated]].map(([label, value]) => <div key={String(label)} className="bg-white border border-nile-100 rounded-lg p-4"><div className="text-xs text-ink/60">{label}</div><div className="text-2xl font-black text-nile-900 mt-1">{value}</div></div>)}</div>
    {!embedded && <form onSubmit={create} className="bg-white border border-nile-100 rounded-lg p-4 grid md:grid-cols-5 gap-3">
      <select required value={form.representativeId} onChange={(e) => setForm({ ...form, representativeId: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2"><option value="">اختر المندوب</option>{reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}</select>
      <select required value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2"><option value="">اختر التاجر</option>{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.businessName || merchant.name}</option>)}</select>
      <input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
      <select value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: Number(e.target.value) })} className="rounded-md border border-nile-100 px-3 py-2">{durations.map((months) => <option key={months} value={months}>{months} شهر</option>)}</select>
      <button className="rounded-md bg-gold-500 text-nile-900 font-bold py-2">إنشاء ارتباط</button>
    </form>}
    <div className="flex flex-wrap gap-2"><input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="بحث بالمندوب أو التاجر" className="rounded-md border border-nile-100 px-3 py-2" /><select aria-label="فلترة المندوب" value={filters.representativeId} onChange={(e) => setFilters({ ...filters, representativeId: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2"><option value="">كل المناديب</option>{reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}</select><select aria-label="فلترة التاجر" value={filters.merchantId} onChange={(e) => setFilters({ ...filters, merchantId: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2"><option value="">كل التجار</option>{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.businessName || merchant.name}</option>)}</select><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2"><option value="">كل الحالات</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="فترة الانتهاء" value={filters.range} onChange={(e) => setFilters({ ...filters, range: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2"><option value="">كل الفترات</option><option value="expiring7">تنتهي خلال 7 أيام</option><option value="expiring30">تنتهي خلال 30 يوم</option></select><input aria-label="من تاريخ" type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" /><input aria-label="إلى تاريخ" type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" /><span className="self-center text-sm text-ink/60">{filteredRows.length} نتيجة</span></div>
    <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto"><table className="w-full text-sm"><thead className="bg-nile-50"><tr>{["المندوب", "التاجر", "البداية", "النهاية", "المدة", "المتبقي", "الحالة", ""].map((heading) => <th key={heading} className="text-start p-3">{heading}</th>)}</tr></thead><tbody>{filteredRows.map((row) => <tr key={row.id} className="border-t border-nile-50"><td className="p-3 font-medium">{row.representative.name}</td><td className="p-3">{row.merchant.businessName}</td><td className="p-3 num">{formatDate(row.startDate)}</td><td className="p-3 num">{formatDate(row.endDate)}</td><td className="p-3 num">{row.durationMonths} شهر</td><td className="p-3 num">{row.daysRemaining} يوم <span className="text-xs text-ink/50">({row.percentageCompleted}%)</span></td><td className="p-3">{statusLabels[row.status] || row.status}</td><td className="p-3 space-x-2 space-x-reverse">{["ACTIVE", "EXPIRING_SOON", "SUSPENDED"].includes(row.status) && <button onClick={() => setTerminationTarget(row)} className="text-danger text-xs underline">فصل</button>}{["EXPIRED", "TERMINATED"].includes(row.status) && <button onClick={() => renew(row)} className="text-nile-700 text-xs underline">تجديد</button>}</td></tr>)}</tbody></table></div>
    {terminationTarget && <div className="fixed inset-0 bg-nile-900/40 flex items-center justify-center p-4"><form onSubmit={(e) => { e.preventDefault(); terminate(); }} className="bg-white rounded-lg p-5 w-full max-w-md space-y-3"><h2 className="font-bold text-lg">فصل المندوب عن التاجر</h2><p className="text-sm text-ink/70">هل أنت متأكد من فصل {terminationTarget.representative.name} عن {terminationTarget.merchant.businessName}؟</p><input required autoFocus value={terminationReason} onChange={(e) => setTerminationReason(e.target.value)} placeholder="سبب الفصل" className="w-full rounded-md border border-nile-100 px-3 py-2" /><div className="flex gap-2 justify-end"><button type="button" onClick={() => setTerminationTarget(null)} className="rounded-md border border-nile-100 px-4 py-2">إلغاء</button><button className="rounded-md bg-danger text-white px-4 py-2">تأكيد الفصل</button></div></form></div>}
  </div>;
}
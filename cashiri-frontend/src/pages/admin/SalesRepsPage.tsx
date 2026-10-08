import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import RepresentativeAssignmentsPage from "./RepresentativeAssignmentsPage";

interface SalesRep { id: string; name: string; phone: string | null; commissionRate: string; status: string; tenantCount: number }

export default function SalesRepsPage() {
  const { push } = useToast();
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [form, setForm] = useState({ name: "", phone: "", commissionRate: 30 });

  function reload() {
    api.get<SalesRep[]>("/api/admin/sales-reps").then(setReps);
  }
  useEffect(reload, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/admin/sales-reps", form);
      push("تم إضافة المندوب ✅", "success");
      setForm({ name: "", phone: "", commissionRate: 30 });
      reload();
    } catch (err: any) {
      push(err.message || "تعذر الإضافة", "error");
    }
  }

  async function toggle(r: SalesRep) {
    await api.post(`/api/admin/sales-reps/${r.id}/${r.status === "active" ? "disable" : "enable"}`);
    reload();
  }

  return (
    <div className="max-w-6xl space-y-4">
      <h1 className="text-2xl font-black text-nile-900">المناديب</h1>

      <form onSubmit={create} className="bg-white border border-nile-100 rounded-lg p-4 grid grid-cols-3 gap-3">
        <input required placeholder="اسم المندوب" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 rounded-md border border-nile-100 px-3 py-2" />
        <input placeholder="رقم الجوال" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
        <div className="col-span-3 flex items-center gap-2">
          <span className="text-sm">نسبة العمولة:</span>
          {[30, 50].map((r) => (
            <button key={r} type="button" onClick={() => setForm({ ...form, commissionRate: r })} className={`rounded px-3 py-1 text-sm ${form.commissionRate === r ? "bg-nile-700 text-paper" : "bg-nile-50"}`}>{r}%</button>
          ))}
          <input type="number" min={0} max={100} value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: Number(e.target.value) })} className="num w-20 rounded-md border border-nile-100 px-2 py-1" placeholder="مخصصة" />
        </div>
        <button type="submit" className="col-span-3 rounded-md bg-gold-500 text-nile-900 font-bold py-2">إضافة مندوب</button>
      </form>

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">الاسم</th><th className="text-start p-3">الجوال</th><th className="text-start p-3">العمولة</th><th className="text-start p-3">التجار</th><th className="text-start p-3">الحالة</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.id} className="border-t border-nile-50">
                <td className="p-3"><Link to={`/admin/sales-reps/${r.id}`} className="text-nile-700 underline font-medium">{r.name}</Link></td>
                <td className="num p-3 text-ink/60">{r.phone || "—"}</td>
                <td className="num p-3">{r.commissionRate}%</td>
                <td className="num p-3">{r.tenantCount}</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${r.status === "active" ? "bg-nile-100 text-nile-900" : "bg-danger/10 text-danger"}`}>{r.status === "active" ? "نشط" : "معطّل"}</span>
                </td>
                <td className="p-3"><button onClick={() => toggle(r)} className="text-nile-700 text-xs underline">{r.status === "active" ? "تعطيل" : "تفعيل"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RepresentativeAssignmentsPage embedded />
    </div>
  );
}

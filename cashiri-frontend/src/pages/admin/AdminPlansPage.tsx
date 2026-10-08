import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface Plan { id: string; name: string; price: string; maxUsers: number | null; maxBranches: number | null; maxProducts: number | null; isActive: boolean }

export default function AdminPlansPage() {
  const { push } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({ name: "", price: 0, maxUsers: "", maxBranches: "", maxProducts: "" });
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

  function reload() {
    api.get<Plan[]>("/api/admin/plans").then(setPlans);
  }
  useEffect(reload, []);

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      price: form.price,
      maxUsers: form.maxUsers ? Number(form.maxUsers) : undefined,
      maxBranches: form.maxBranches ? Number(form.maxBranches) : undefined,
      maxProducts: form.maxProducts ? Number(form.maxProducts) : undefined,
    };
    if (editingPlanId) {
      await api.patch(`/api/admin/plans/${editingPlanId}`, payload);
      push("تم تعديل الباقة", "success");
    } else {
      await api.post("/api/admin/plans", payload);
      push("تم إنشاء الباقة", "success");
    }
    setEditingPlanId(null);
    setForm({ name: "", price: 0, maxUsers: "", maxBranches: "", maxProducts: "" });
    reload();
  }

  function startEdit(plan: Plan) {
    setEditingPlanId(plan.id);
    setForm({
      name: plan.name,
      price: Number(plan.price),
      maxUsers: plan.maxUsers == null ? "" : String(plan.maxUsers),
      maxBranches: plan.maxBranches == null ? "" : String(plan.maxBranches),
      maxProducts: plan.maxProducts == null ? "" : String(plan.maxProducts),
    });
  }

  function cancelEdit() {
    setEditingPlanId(null);
    setForm({ name: "", price: 0, maxUsers: "", maxBranches: "", maxProducts: "" });
  }

  async function toggleActive(plan: Plan) {
    await api.patch(`/api/admin/plans/${plan.id}`, { isActive: !plan.isActive });
    reload();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-black text-nile-900">إدارة الباقات</h1>

      <form onSubmit={createPlan} className="bg-white border border-nile-100 rounded-lg p-4 grid grid-cols-2 gap-3">
        <input required placeholder="اسم الباقة" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 rounded-md border border-nile-100 px-3 py-2" />
        <label className="text-sm">السعر
          <input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
        </label>
        <label className="text-sm">عدد المستخدمين (اختياري)
          <input type="number" min={0} value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
        </label>
        <label className="text-sm">عدد الفروع (اختياري)
          <input type="number" min={0} value={form.maxBranches} onChange={(e) => setForm({ ...form, maxBranches: e.target.value })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
        </label>
        <label className="text-sm">عدد المنتجات (اختياري)
          <input type="number" min={0} value={form.maxProducts} onChange={(e) => setForm({ ...form, maxProducts: e.target.value })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
        </label>
        <button type="submit" className="col-span-2 rounded-md bg-gold-500 text-nile-900 font-bold py-2">{editingPlanId ? "حفظ تعديل الباقة" : "إنشاء الباقة"}</button>
        {editingPlanId && <button type="button" onClick={cancelEdit} className="col-span-2 rounded-md border border-nile-100 py-2 text-sm">إلغاء التعديل</button>}
      </form>

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">الباقة</th><th className="text-start p-3">السعر</th><th className="text-start p-3">الحدود</th><th className="text-start p-3">الحالة</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t border-nile-50">
                <td className="p-3 font-medium">{p.name}</td>
                <td className="num p-3">{Number(p.price).toLocaleString()} SDG</td>
                <td className="num p-3 text-ink/60 text-xs">
                  {p.maxUsers ? `${p.maxUsers} مستخدم` : "غير محدود"} · {p.maxBranches ? `${p.maxBranches} فرع` : "غير محدود"} · {p.maxProducts ? `${p.maxProducts} منتج` : "غير محدود"}
                </td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${p.isActive ? "bg-nile-100 text-nile-900" : "bg-danger/10 text-danger"}`}>{p.isActive ? "مفعّلة" : "معطّلة"}</span>
                </td>
                <td className="p-3">
                  <div className="flex gap-3">
                    <button onClick={() => startEdit(p)} className="text-nile-700 text-xs underline">تعديل</button>
                    <button onClick={() => toggleActive(p)} className="text-nile-700 text-xs underline">{p.isActive ? "تعطيل" : "تفعيل"}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

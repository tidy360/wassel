import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface SuperAdmin { id: string; name: string; email: string; status: string }

export default function AdminSuperAdminsPage() {
  const { push } = useToast();
  const [admins, setAdmins] = useState<SuperAdmin[]>([]);
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "" });

  function reload() {
    api.get<SuperAdmin[]>("/api/admin/super-admins").then(setAdmins);
  }
  useEffect(reload, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/admin/super-admins", form);
      push("تم إنشاء حساب Super Admin جديد ✅", "success");
      setForm({ name: "", username: "", email: "", password: "" });
      reload();
    } catch (err: any) {
      push(err.message || "تعذر الإنشاء", "error");
    }
  }

  async function toggle(a: SuperAdmin) {
    await api.post(`/api/admin/super-admins/${a.id}/${a.status === "active" ? "disable" : "enable"}`);
    reload();
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-black text-nile-900">حسابات Super Admin</h1>

      <form onSubmit={create} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
        <input required placeholder="الاسم" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <input required minLength={3} dir="ltr" placeholder="اسم المستخدم" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <input type="email" dir="ltr" placeholder="البريد الإلكتروني (اختياري)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <input required type="password" dir="ltr" placeholder="كلمة المرور" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <button type="submit" className="rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2">إنشاء حساب جديد</button>
      </form>

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">الاسم</th><th className="text-start p-3">البريد</th><th className="text-start p-3">الحالة</th><th className="p-3"></th></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-t border-nile-50">
                <td className="p-3">{a.name}</td>
                <td className="p-3 text-ink/60" dir="ltr">{a.email}</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${a.status === "active" ? "bg-nile-100 text-nile-900" : "bg-danger/10 text-danger"}`}>{a.status === "active" ? "نشط" : "معطّل"}</span>
                </td>
                <td className="p-3"><button onClick={() => toggle(a)} className="text-nile-700 text-xs underline">{a.status === "active" ? "تعطيل" : "تفعيل"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

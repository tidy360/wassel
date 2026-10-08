import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface PlatformUser { id: string; name: string; username: string; email: string | null; status: string; roles: string[] }

const ROLE_LABELS: Record<string, string> = { ACCOUNTANT: "محاسب", CUSTOMER_SERVICE: "خدمة العملاء" };

export default function AdminPlatformUsersPage() {
  const { push } = useToast();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "", roleName: "ACCOUNTANT" as "ACCOUNTANT" | "CUSTOMER_SERVICE" });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  function reload() {
    api.get<PlatformUser[]>("/api/admin/platform-users").then(setUsers);
  }
  useEffect(reload, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingUserId) {
        await api.patch(`/api/admin/platform-users/${editingUserId}`, { ...form, password: form.password || undefined });
        push("تم تعديل الحساب ✅", "success");
      } else {
        await api.post("/api/admin/platform-users", form);
        push("تم إنشاء الحساب ✅", "success");
      }
      setEditingUserId(null);
      setForm({ name: "", username: "", email: "", password: "", roleName: "ACCOUNTANT" });
      reload();
    } catch (err: any) {
      push(err.message || "تعذر الإنشاء", "error");
    }
  }

  function startEdit(user: PlatformUser) {
    setEditingUserId(user.id);
    setForm({ name: user.name, username: user.username, email: user.email ?? "", password: "", roleName: (user.roles[0] as "ACCOUNTANT" | "CUSTOMER_SERVICE") ?? "ACCOUNTANT" });
  }

  function cancelEdit() {
    setEditingUserId(null);
    setForm({ name: "", username: "", email: "", password: "", roleName: "ACCOUNTANT" });
  }

  async function toggle(u: PlatformUser) {
    await api.post(`/api/admin/platform-users/${u.id}/${u.status === "active" ? "disable" : "enable"}`);
    reload();
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-black text-nile-900">موظفو المنصة (محاسب / خدمة عملاء)</h1>

      <form onSubmit={create} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
        <input required placeholder="الاسم" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <input required minLength={3} dir="ltr" placeholder="اسم المستخدم" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <input type="email" dir="ltr" placeholder="البريد الإلكتروني (اختياري)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <input required={!editingUserId} type="password" dir="ltr" placeholder={editingUserId ? "كلمة المرور الجديدة (اختياري)" : "كلمة المرور"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <select value={form.roleName} onChange={(e) => setForm({ ...form, roleName: e.target.value as any })} className="w-full rounded-md border border-nile-100 px-3 py-2">
          <option value="ACCOUNTANT">محاسب (قراءة فقط للبيانات المالية)</option>
          <option value="CUSTOMER_SERVICE">خدمة العملاء (تجديد/إيقاف الاشتراك فقط)</option>
        </select>
        <button type="submit" className="rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2">{editingUserId ? "حفظ تعديل الحساب" : "إنشاء حساب"}</button>
        {editingUserId && <button type="button" onClick={cancelEdit} className="rounded-md border border-nile-100 px-6 py-2 text-sm">إلغاء</button>}
      </form>

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">الاسم</th><th className="text-start p-3">الدور</th><th className="text-start p-3">الحالة</th><th className="p-3"></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-nile-50">
                <td className="p-3">{u.name}<div className="text-xs text-ink/50" dir="ltr">@{u.username}{u.email ? ` · ${u.email}` : ""}</div></td>
                <td className="p-3">{u.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${u.status === "active" ? "bg-nile-100 text-nile-900" : "bg-danger/10 text-danger"}`}>{u.status === "active" ? "نشط" : "معطّل"}</span>
                </td>
                <td className="p-3"><div className="flex gap-3"><button onClick={() => startEdit(u)} className="text-nile-700 text-xs underline">تعديل</button><button onClick={() => toggle(u)} className="text-nile-700 text-xs underline">{u.status === "active" ? "تعطيل" : "تفعيل"}</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface User { id: string; name: string; username: string | null; email: string | null; status: string; roles: string[] }

const ROLE_OPTIONS = ["ADMIN", "MANAGER", "CASHIER", "STORE_STAFF"] as const;

export default function UsersPage() {
  const { t } = useLang();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "", roleName: "CASHIER" as (typeof ROLE_OPTIONS)[number] });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reload() {
    api.get<User[]>("/api/store/users").then(setUsers);
  }
  useEffect(reload, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setMessage("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.post("/api/store/users", form);
      setForm({ name: "", username: "", email: "", password: "", roleName: "CASHIER" });
      setMessage("تمت إضافة المستخدم بنجاح");
      reload();
    } catch (error: any) {
      setMessage(error.message || "تعذر إضافة المستخدم");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(u: User) {
    await api.post(`/api/store/users/${u.id}/${u.status === "active" ? "disable" : "enable"}`);
    reload();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-black text-nile-900">إدارة المستخدمين</h1>

      <form onSubmit={addUser} className="bg-white border border-nile-100 rounded-lg p-4 grid grid-cols-2 gap-3">
        <input required placeholder="الاسم" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
        <input required minLength={3} placeholder="اسم المستخدم" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
        <input type="email" placeholder="البريد الإلكتروني (اختياري)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
        <input required minLength={8} type="password" placeholder="كلمة المرور (8 أحرف على الأقل)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
        <select value={form.roleName} onChange={(e) => setForm({ ...form, roleName: e.target.value as any })} className="rounded-md border border-nile-100 px-3 py-2">
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" disabled={saving} className="col-span-2 rounded-md bg-gold-500 text-nile-900 font-bold py-2 disabled:opacity-60">{saving ? "جاري الإضافة..." : "إضافة مستخدم"}</button>
      </form>

      {message && <p className="rounded-md bg-nile-50 px-3 py-2 text-sm text-nile-800">{message}</p>}

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">الاسم</th><th className="text-start p-3">اسم المستخدم</th><th className="text-start p-3">البريد</th><th className="text-start p-3">الدور</th><th className="text-start p-3">الحالة</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-nile-50">
                <td className="p-3">{u.name}</td>
                <td className="p-3 font-mono text-xs" dir="ltr">{u.username ?? "—"}</td>
                <td className="p-3 text-ink/60" dir="ltr">{u.email ?? "—"}</td>
                <td className="p-3">{u.roles.join(", ")}</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${u.status === "active" ? "bg-nile-100 text-nile-900" : "bg-danger/10 text-danger"}`}>
                    {u.status === "active" ? "نشط" : "معطّل"}
                  </span>
                </td>
                <td className="p-3">
                  <button onClick={() => toggle(u)} className="text-nile-700 text-xs underline">{u.status === "active" ? "تعطيل" : "تفعيل"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

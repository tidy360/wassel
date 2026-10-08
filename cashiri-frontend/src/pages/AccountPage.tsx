import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../api/client";

export default function AccountPage() {
  const { user } = useAuth();
  const { push } = useToast();
  const [form, setForm] = useState({ name: user?.name ?? "", email: user?.email ?? "", currentPassword: "", newPassword: "" });
  const [resetMode, setResetMode] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState(user?.email ?? "");
  const [resetToken, setResetToken] = useState("");
  const [newResetPassword, setNewResetPassword] = useState("");
  const [resetRequested, setResetRequested] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.patch("/api/auth/me", {
        name: form.name || undefined,
        email: form.email || undefined,
        currentPassword: form.currentPassword,
        newPassword: form.newPassword || undefined,
      });
      const stored = JSON.parse(localStorage.getItem("cashiri_user") || "{}");
      localStorage.setItem("cashiri_user", JSON.stringify({ ...stored, name: form.name, email: form.email }));
      push("تم تحديث الحساب بنجاح ✅", "success");
      setForm((f) => ({ ...f, currentPassword: "", newPassword: "" }));
    } catch (err: any) {
      push(err.message || "تعذر التحديث", "error");
    }
  }

  async function requestPasswordReset() {
    try {
      const res = await api.post<{ message: string; resetToken?: string }>("/api/auth/forgot-password", { identifier: resetIdentifier });
      if (res.resetToken) setResetToken(res.resetToken);
      setResetRequested(true);
      push(res.message || "تم إرسال رمز الاسترجاع", "success");
    } catch (err: any) {
      push(err.message || "تعذر إرسال رمز الاسترجاع", "error");
    }
  }

  async function confirmPasswordReset() {
    try {
      await api.post("/api/auth/reset-password", { token: resetToken, newPassword: newResetPassword });
      push("تم تحديث كلمة المرور بنجاح ✅", "success");
      setResetMode(false);
      setResetRequested(false);
      setResetToken("");
      setNewResetPassword("");
    } catch (err: any) {
      push(err.message || "تعذر تحديث كلمة المرور", "error");
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-black text-nile-900">حسابي</h1>

      {!resetMode ? (
        <form onSubmit={submit} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <label className="text-sm">الاسم
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <label className="text-sm">البريد الإلكتروني
            <input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <label className="text-sm">كلمة المرور الجديدة (اتركها فاضية لو ما تبي تغييرها)
            <input type="password" dir="ltr" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <label className="text-sm">كلمة المرور الحالية (مطلوبة للتأكيد)
            <input required type="password" dir="ltr" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <button type="submit" className="rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2">حفظ التغييرات</button>
          <button type="button" onClick={() => setResetMode(true)} className="w-full text-center text-sm text-nile-700 underline">نسيت كلمة المرور؟</button>
        </form>
      ) : (
        <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <div className="text-sm font-bold text-nile-900">استعادة كلمة المرور</div>
          <label className="text-sm">اسم المستخدم أو البريد الإلكتروني
            <input type="text" dir="ltr" value={resetIdentifier} onChange={(e) => setResetIdentifier(e.target.value)} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>

          {!resetRequested ? (
            <button type="button" onClick={requestPasswordReset} className="rounded-md bg-nile-700 text-paper font-bold px-6 py-2">إرسال رمز الاسترجاع</button>
          ) : (
            <>
              <label className="text-sm">رمز الاسترجاع
                <input type="text" dir="ltr" value={resetToken} onChange={(e) => setResetToken(e.target.value)} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
              </label>
              <label className="text-sm">كلمة المرور الجديدة
                <input type="password" dir="ltr" value={newResetPassword} onChange={(e) => setNewResetPassword(e.target.value)} className="w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
              </label>
              <button type="button" onClick={confirmPasswordReset} className="rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2">تحديث كلمة المرور</button>
            </>
          )}

          <button type="button" onClick={() => { setResetMode(false); setResetRequested(false); setResetToken(""); setNewResetPassword(""); }} className="w-full text-center text-sm text-nile-700 underline">العودة</button>
        </div>
      )}
    </div>
  );
}

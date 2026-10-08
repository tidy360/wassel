import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../i18n";
import { api, ApiError } from "../api/client";

export default function LoginPage() {
  const { login } = useAuth();
  const { t, lang, toggle } = useLang();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(identifier, password, rememberMe);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<{ message: string; resetToken?: string }>("/api/auth/forgot-password", { identifier });
      if (data.resetToken) setResetToken(data.resetToken);
      setResetRequested(true);
    } catch (err: any) {
      setError(err.message || "تعذر طلب الاسترجاع");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/reset-password", { token: resetToken, newPassword });
      setForgotMode(false);
      setResetRequested(false);
      setPassword("");
      setNewPassword("");
      setError("تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.");
    } catch (err: any) {
      setError(err.message || "تعذر تغيير كلمة المرور");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-nile-700 text-paper text-2xl font-black mb-3">ك</div>
          <h1 className="text-3xl font-black text-nile-900">{t("appName")}</h1>
        </div>

        <form onSubmit={forgotMode ? (resetRequested ? resetPassword : requestReset) : onSubmit} className="bg-white border border-nile-100 rounded-lg p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">اسم المستخدم أو البريد الإلكتروني</label>
            <input
              type="text"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-md border border-nile-100 px-3 py-2 focus:border-nile-500 outline-none"
              dir="ltr"
            />
          </div>
          {!forgotMode && <div>
            <label className="block text-sm font-medium text-ink mb-1">{t("password")}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-nile-100 px-3 py-2 focus:border-nile-500 outline-none"
              dir="ltr"
            />
          </div>}

          {!forgotMode && <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            تذكرني
          </label>}

          {forgotMode && resetRequested && <>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">رمز الاسترجاع</label>
              <input required value={resetToken} onChange={(e) => setResetToken(e.target.value)} className="w-full rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">كلمة المرور الجديدة</label>
              <input required minLength={4} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
            </div>
          </>}

          {error && <p className="text-danger text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-nile-700 text-paper font-semibold py-2.5 hover:bg-nile-900 transition-colors disabled:opacity-60"
          >
            {loading ? "..." : forgotMode ? (resetRequested ? "تغيير كلمة المرور" : "إرسال رمز الاسترجاع") : t("login")}
          </button>
          <button type="button" onClick={() => { setForgotMode(!forgotMode); setResetRequested(false); setError(null); }} className="w-full text-center text-sm text-nile-700 underline">
            {forgotMode ? "العودة لتسجيل الدخول" : "نسيت كلمة المرور؟"}
          </button>
        </form>

        <button onClick={toggle} className="mt-4 w-full text-center text-sm text-nile-700 underline">
          {lang === "ar" ? "English" : "العربية"}
        </button>
      </div>
    </div>
  );
}

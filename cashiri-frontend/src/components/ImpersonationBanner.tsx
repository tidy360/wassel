import { useAuth } from "../context/AuthContext";

export default function ImpersonationBanner() {
  const { isImpersonating, switchBack, user } = useAuth();
  if (!isImpersonating) return null;

  return (
    <div className="bg-gold-500 text-nile-900 text-sm font-medium px-4 py-2 flex items-center justify-between">
      <span>⚠️ أنت تعمل الآن داخل حساب: {user?.name} (وضع محاكاة Super Admin) — العمليات الحساسة معطّلة.</span>
      <button onClick={switchBack} className="rounded bg-nile-900 text-paper px-3 py-1 text-xs font-bold">
        الرجوع لحسابي
      </button>
    </div>
  );
}

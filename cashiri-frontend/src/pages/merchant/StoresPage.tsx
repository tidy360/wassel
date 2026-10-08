import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface Store { id: string; name: string; isMain: boolean; isActive: boolean; city: string | null; _count: { users: number; branches: number } }

export default function StoresPage() {
  const { push } = useToast();
  const [stores, setStores] = useState<Store[]>([]);

  async function load() {
    try { setStores(await api.get<Store[]>("/api/store/stores")); }
    catch (error: any) { push(error.message || "تعذر تحميل الفروع", "error"); }
  }
  useEffect(() => { void load(); }, []);

  async function toggle(store: Store) {
    try {
      await api.patch(`/api/store/stores/${store.id}/status`, { isActive: !store.isActive });
      push(store.isActive ? "تم إيقاف الفرع" : "تم تفعيل الفرع", "success");
      await load();
    } catch (error: any) { push(error.message || "تعذر تحديث الفرع", "error"); }
  }

  return <div className="space-y-4">
    <div><h1 className="text-2xl font-black text-nile-900">الفروع</h1><p className="text-sm text-ink/60 mt-1">الفرع الرئيسي والإدارة المركزية يشاهدان بيانات كل الفروع.</p></div>
    <div className="grid gap-3 md:grid-cols-2">{stores.map((store) => <div key={store.id} className="rounded-lg border border-nile-100 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-nile-900">{store.name}</h2>{store.isMain && <span className="rounded bg-gold-500/20 px-2 py-1 text-xs font-bold">الفرع الرئيسي</span>}</div>
      <div className="text-sm text-ink/60">{store.city || "بدون مدينة"} · {store._count.users} مستخدم · {store._count.branches} فروع داخلية</div>
      <div className="flex items-center justify-between"><span className={`text-xs font-bold ${store.isActive ? "text-nile-700" : "text-danger"}`}>{store.isActive ? "نشط" : "موقوف"}</span><button type="button" disabled={store.isMain} onClick={() => void toggle(store)} className="rounded bg-nile-700 px-3 py-1 text-xs font-bold text-white disabled:opacity-40">{store.isActive ? "إيقاف الفرع" : "تفعيل الفرع"}</button></div>
    </div>)}</div>
  </div>;
}

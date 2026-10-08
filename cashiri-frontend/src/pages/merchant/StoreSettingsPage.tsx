import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { useLang } from "../../i18n";

interface Store { id: string; name: string; phone: string | null; address: string | null; currency: string }
interface Tax { id: string; name: string; rate: string; isEnabled: boolean }
interface PaymentMethod { id: string; name: string; code: string; requiresAttachment: boolean; isActive: boolean }
interface CatalogItem { id: string; name: string }

export default function StoreSettingsPage() {
  const { t } = useLang();
  const { push } = useToast();
  const [tab, setTab] = useState<"profile" | "tax" | "payment" | "catalog">("profile");
  const [store, setStore] = useState<Store | null>(null);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [newTax, setNewTax] = useState({ name: "", rate: 0 });
  const [newMethod, setNewMethod] = useState({ name: "", code: "", requiresAttachment: false });
  const [categories, setCategories] = useState<CatalogItem[]>([]);
  const [units, setUnits] = useState<CatalogItem[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [unitName, setUnitName] = useState("");

  function reload() {
    api.get<Store>("/api/store/settings/store").then(setStore);
    api.get<Tax[]>("/api/store/settings/taxes").then(setTaxes);
    api.get<PaymentMethod[]>("/api/store/settings/payment-methods").then(setMethods);
    api.get<CatalogItem[]>("/api/store/categories").then(setCategories);
    api.get<CatalogItem[]>("/api/store/units").then(setUnits);
  }
  useEffect(reload, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!store) return;
    try {
      await api.patch("/api/store/settings/store", {
        name: store.name,
        phone: store.phone || undefined,
        address: store.address || undefined,
        currency: store.currency,
      });
      push("تم حفظ بيانات المتجر", "success");
    } catch (error: any) {
      push(error.message || "تعذر حفظ بيانات المتجر", "error");
    }
  }

  async function addTax() {
    if (!newTax.name) return;
    await api.post("/api/store/settings/taxes", { ...newTax, isEnabled: true, included: false });
    setNewTax({ name: "", rate: 0 });
    reload();
  }
  async function toggleTax(taxItem: Tax) {
    await api.patch(`/api/store/settings/taxes/${taxItem.id}`, { name: taxItem.name, rate: Number(taxItem.rate), isEnabled: !taxItem.isEnabled });
    reload();
  }

  async function addMethod() {
    if (!newMethod.name || !newMethod.code) return;
    await api.post("/api/store/settings/payment-methods", { ...newMethod, isActive: true });
    setNewMethod({ name: "", code: "", requiresAttachment: false });
    reload();
  }

  async function addCategory() {
    if (!categoryName.trim()) return;
    await api.post("/api/store/categories", { name: categoryName.trim() });
    setCategoryName("");
    reload();
  }

  async function addUnit() {
    if (!unitName.trim()) return;
    await api.post("/api/store/units", { name: unitName.trim() });
    setUnitName("");
    reload();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{t("settings")}</h1>

      <div className="flex gap-2 border-b border-nile-100">
        {(["profile", "tax", "payment", "catalog"] as const).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === tb ? "border-nile-700 text-nile-900" : "border-transparent text-ink/50"}`}>
            {tb === "profile" ? "بيانات المتجر" : tb === "tax" ? "الضريبة" : tb === "payment" ? "طرق الدفع" : "التصنيفات والوحدات"}
          </button>
        ))}
      </div>

      {tab === "profile" && store && (
        <div className="space-y-4">
          <form onSubmit={saveProfile} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
            <input value={store.name} onChange={(e) => setStore({ ...store, name: e.target.value })} placeholder="اسم المتجر" className="w-full rounded-md border border-nile-100 px-3 py-2" />
            <input value={store.phone ?? ""} onChange={(e) => setStore({ ...store, phone: e.target.value })} placeholder="الهاتف" className="w-full rounded-md border border-nile-100 px-3 py-2" />
            <input value={store.address ?? ""} onChange={(e) => setStore({ ...store, address: e.target.value })} placeholder="العنوان" className="w-full rounded-md border border-nile-100 px-3 py-2" />
            <button type="submit" className="rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2">حفظ</button>
          </form>
        </div>
      )}

      {tab === "tax" && (
        <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          {taxes.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between border-b border-nile-50 pb-2">
              <span>{tx.name} — {tx.rate}%</span>
              <button onClick={() => toggleTax(tx)} className={`rounded px-3 py-1 text-xs font-medium ${tx.isEnabled ? "bg-nile-700 text-paper" : "bg-nile-50"}`}>
                {tx.isEnabled ? "مفعّلة" : "معطّلة"}
              </button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <input placeholder="اسم الضريبة" value={newTax.name} onChange={(e) => setNewTax({ ...newTax, name: e.target.value })} className="flex-1 rounded-md border border-nile-100 px-3 py-2" />
            <input type="number" placeholder="النسبة %" value={newTax.rate} onChange={(e) => setNewTax({ ...newTax, rate: Number(e.target.value) })} className="num w-28 rounded-md border border-nile-100 px-3 py-2" />
            <button onClick={addTax} className="rounded-md bg-nile-700 text-paper px-4 text-sm">إضافة</button>
          </div>
        </div>
      )}

      {tab === "payment" && (
        <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          {methods.map((m) => (
            <div key={m.id} className="flex items-center justify-between border-b border-nile-50 pb-2">
              <span>{m.name} {m.requiresAttachment && "📎"}</span>
              <span className="text-xs text-ink/50">{m.code}</span>
            </div>
          ))}
          <div className="flex gap-2 pt-2 flex-wrap">
            <input placeholder="اسم طريقة الدفع" value={newMethod.name} onChange={(e) => setNewMethod({ ...newMethod, name: e.target.value })} className="flex-1 rounded-md border border-nile-100 px-3 py-2" />
            <input placeholder="الرمز (cash/card/transfer)" value={newMethod.code} onChange={(e) => setNewMethod({ ...newMethod, code: e.target.value })} className="w-40 rounded-md border border-nile-100 px-3 py-2" />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={newMethod.requiresAttachment} onChange={(e) => setNewMethod({ ...newMethod, requiresAttachment: e.target.checked })} />
              يتطلب صورة إيصال
            </label>
            <button onClick={addMethod} className="rounded-md bg-nile-700 text-paper px-4 text-sm">إضافة</button>
          </div>
        </div>
      )}

      {tab === "catalog" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
            <h2 className="font-bold text-nile-900">تصنيفات المنتجات</h2>
            <div className="flex gap-2">
              <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="اسم التصنيف" className="min-w-0 flex-1 rounded-md border border-nile-100 px-3 py-2" />
              <button type="button" onClick={addCategory} className="rounded-md bg-gold-500 text-nile-900 px-4 text-sm font-bold">إضافة</button>
            </div>
            {categories.map((category) => <div key={category.id} className="border-b border-nile-50 py-2 text-sm">{category.name}</div>)}
            {categories.length === 0 && <p className="text-sm text-ink/50">لا توجد تصنيفات بعد</p>}
          </div>
          <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
            <h2 className="font-bold text-nile-900">وحدات القياس</h2>
            <div className="flex gap-2">
              <input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="اسم الوحدة" className="min-w-0 flex-1 rounded-md border border-nile-100 px-3 py-2" />
              <button type="button" onClick={addUnit} className="rounded-md bg-gold-500 text-nile-900 px-4 text-sm font-bold">إضافة</button>
            </div>
            {units.map((unit) => <div key={unit.id} className="border-b border-nile-50 py-2 text-sm">{unit.name}</div>)}
            {units.length === 0 && <p className="text-sm text-ink/50">لا توجد وحدات بعد</p>}
          </div>
        </div>
      )}
    </div>
  );
}

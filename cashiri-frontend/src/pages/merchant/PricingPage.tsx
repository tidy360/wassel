import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface PricingProduct {
  id: string;
  name: string;
  salePrice: string;
  purchasePrice: string;
  currentCost: number;
  currentMargin: number;
  pricing?: { pricingMode: string; costMethod: string; profitMargin: string; suggestedPrice: string | null; suggestionReason: string | null } | null;
  pendingProposal?: { id: string; suggestedPrice: string; reason: string } | null;
  priceStatus: string;
}
interface Settings { defaultProfitMargin: number; minimumProfitMargin: number; roundingUnit: number; defaultCurrency: string; defaultPricingMode: string; defaultCostMethod: string; }

const statusLabels: Record<string, string> = { UP_TO_DATE: "محدث", PENDING_APPROVAL: "بانتظار الموافقة", BELOW_COST: "أقل من التكلفة", BELOW_MINIMUM_MARGIN: "أقل من الحد الأدنى" };

export default function PricingPage() {
  const { push } = useToast();
  const [products, setProducts] = useState<PricingProduct[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rate, setRate] = useState({ currency: "USD", rate: "", notes: "" });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [productResponse, settingsResponse] = await Promise.all([
        api.get<{ data: PricingProduct[] }>("/api/store/pricing/products?pageSize=500"),
        api.get<Settings>("/api/store/pricing/settings"),
      ]);
      setProducts(productResponse.data);
      setSettings(settingsResponse);
    } catch (error: any) {
      push(error.message || "تعذر تحميل إدارة الأسعار", "error");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function recalculate(product: PricingProduct) {
    try {
      await api.post(`/api/store/pricing/products/${product.id}/recalculate`, { reason: "COST_CHANGE" });
      push("تم تحديث السعر المقترح", "success");
      await load();
    } catch (error: any) { push(error.message || "تعذر إعادة الحساب", "error"); }
  }

  async function changePricingMode(product: PricingProduct, pricingMode: string) {
    try {
      await api.patch(`/api/store/pricing/products/${product.id}`, { pricingMode, profitMargin: Number(product.pricing?.profitMargin ?? settings?.defaultProfitMargin ?? 0) });
      push("تم تحديث وضع التسعير", "success");
      await load();
    } catch (error: any) { push(error.message || "تعذر تحديث وضع التسعير", "error"); }
  }

  async function approve(proposalId: string) {
    try {
      await api.post(`/api/store/pricing/proposals/${proposalId}/approve`);
      push("تم اعتماد السعر الجديد", "success");
      await load();
    } catch (error: any) { push(error.message || "تعذر اعتماد السعر", "error"); }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    try {
      await api.put("/api/store/pricing/settings", {
        defaultPricingMode: settings.defaultPricingMode,
        defaultProfitMargin: Number(settings.defaultProfitMargin),
        minimumProfitMargin: Number(settings.minimumProfitMargin),
        defaultCostMethod: settings.defaultCostMethod,
        defaultCurrency: settings.defaultCurrency,
        roundingUnit: Number(settings.roundingUnit),
      });
      push("تم حفظ إعدادات التسعير", "success");
    } catch (error: any) { push(error.message || "تعذر حفظ الإعدادات", "error"); }
  }

  async function addRate(event: React.FormEvent) {
    event.preventDefault();
    if (!rate.rate) return;
    try {
      await api.post("/api/store/exchange-rates", { ...rate, rate: Number(rate.rate) });
      setRate({ ...rate, rate: "", notes: "" });
      push("تم تحديث سعر الصرف وإنشاء المقترحات", "success");
      await load();
    } catch (error: any) { push(error.message || "تعذر تحديث سعر الصرف", "error"); }
  }

  const pending = products.filter((product) => product.pendingProposal).length;
  const belowCost = products.filter((product) => product.priceStatus === "BELOW_COST").length;
  const belowMinimum = products.filter((product) => settings && product.currentMargin < Number(settings.minimumProfitMargin)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-black text-nile-900">إدارة الأسعار</h1><p className="text-sm text-ink/60 mt-1">التكلفة تغيّر السعر المقترح فقط، والسعر الحالي لا يتغير إلا بعد الاعتماد.</p></div>
        <button type="button" onClick={() => void load()} className="rounded-md border border-nile-200 bg-white px-3 py-2 text-sm">تحديث</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-nile-100 bg-white p-4"><div className="text-sm text-ink/60">تحتاج مراجعة</div><div className="text-2xl font-black text-gold-600">{pending}</div></div>
        <div className="rounded-lg border border-nile-100 bg-white p-4"><div className="text-sm text-ink/60">أقل من التكلفة</div><div className="text-2xl font-black text-danger">{belowCost}</div></div>
        <div className="rounded-lg border border-nile-100 bg-white p-4"><div className="text-sm text-ink/60">أقل من الحد الأدنى</div><div className="text-2xl font-black text-gold-600">{belowMinimum}</div></div>
        <div className="rounded-lg border border-nile-100 bg-white p-4"><div className="text-sm text-ink/60">إجمالي المنتجات</div><div className="text-2xl font-black text-nile-900">{products.length}</div></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white border border-nile-100 rounded-lg overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">المنتج</th><th className="text-start p-3">وضع التسعير</th><th className="text-start p-3">السعر الحالي</th><th className="text-start p-3">التكلفة</th><th className="text-start p-3">المقترح</th><th className="text-start p-3">الحالة</th><th className="p-3" /></tr></thead>
            <tbody>{loading ? <tr><td colSpan={7} className="p-6 text-center">جارٍ التحميل...</td></tr> : products.map((product) => <tr key={product.id} className="border-t border-nile-50">
              <td className="p-3 font-medium">{product.name}</td><td className="p-3"><select value={product.pricing?.pricingMode ?? "MANUAL"} onChange={(e) => void changePricingMode(product, e.target.value)} className="rounded border border-nile-100 px-2 py-1 text-xs"><option value="MANUAL">يدوي</option><option value="COST_PLUS">تكلفة + هامش</option><option value="DYNAMIC">ديناميكي</option></select></td><td className="num p-3">{Number(product.salePrice).toLocaleString()} SDG</td><td className="num p-3">{product.currentCost.toLocaleString()} SDG</td>
              <td className="num p-3">{product.pendingProposal ? `${Number(product.pendingProposal.suggestedPrice).toLocaleString()} SDG` : "—"}</td>
              <td className="p-3"><span className={`rounded px-2 py-1 text-xs ${product.priceStatus === "BELOW_COST" ? "bg-danger/10 text-danger" : product.pendingProposal ? "bg-gold-500/20 text-gold-700" : "bg-nile-50 text-nile-800"}`}>{statusLabels[product.priceStatus] ?? product.priceStatus}</span></td>
              <td className="p-3 text-end space-x-2 space-x-reverse">{product.pendingProposal ? <button type="button" onClick={() => void approve(product.pendingProposal!.id)} className="rounded bg-gold-500 px-2 py-1 text-xs font-bold">اعتماد</button> : <button type="button" onClick={() => void recalculate(product)} className="text-nile-700 text-xs underline">إعادة حساب</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="space-y-4">
          {settings && <form onSubmit={saveSettings} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3"><h2 className="font-bold text-nile-900">إعدادات التسعير</h2>
            <label className="block text-sm">هامش الربح الافتراضي<input type="number" min="0" value={settings.defaultProfitMargin} onChange={(e) => setSettings({ ...settings, defaultProfitMargin: Number(e.target.value) })} className="mt-1 w-full rounded border border-nile-100 px-2 py-1" /></label>
            <label className="block text-sm">الحد الأدنى للهامش<input type="number" min="0" value={settings.minimumProfitMargin} onChange={(e) => setSettings({ ...settings, minimumProfitMargin: Number(e.target.value) })} className="mt-1 w-full rounded border border-nile-100 px-2 py-1" /></label>
            <label className="block text-sm">التقريب إلى<input type="number" min="1" value={settings.roundingUnit} onChange={(e) => setSettings({ ...settings, roundingUnit: Number(e.target.value) })} className="mt-1 w-full rounded border border-nile-100 px-2 py-1" /></label>
            <button className="w-full rounded bg-nile-700 text-white px-3 py-2 text-sm font-bold">حفظ الإعدادات</button>
            <p className="text-xs leading-5 text-ink/60">يُستخدم هامش الربح والتقريب لحساب السعر المقترح. لن يتغير سعر البيع الحالي إلا بعد مراجعة السعر واعتماده.</p>
          </form>}
          <form onSubmit={addRate} className="bg-white border border-nile-100 rounded-lg p-4 space-y-3"><h2 className="font-bold text-nile-900">إدارة سعر الصرف</h2><select value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })} className="w-full rounded border border-nile-100 px-2 py-1"><option>USD</option><option>SAR</option><option>EUR</option></select><input required type="number" min="0" step="any" placeholder="السعر مقابل العملة المحلية" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} className="w-full rounded border border-nile-100 px-2 py-1" /><input placeholder="ملاحظات" value={rate.notes} onChange={(e) => setRate({ ...rate, notes: e.target.value })} className="w-full rounded border border-nile-100 px-2 py-1" /><button className="w-full rounded bg-gold-500 text-nile-900 px-3 py-2 text-sm font-bold">تحديث سعر الصرف</button></form>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { useLang } from "../../i18n";

interface Category { id: string; name: string }
interface Unit { id: string; name: string }
interface ProductOption { id: string; name: string; productType: string; purchasePrice: string; salePrice: string }
interface BomItem { componentProductId: string; quantity: number; isOptional: boolean; wastePercent: number }
interface BomResponseItem { componentProductId: string; quantity: string | number; isOptional: boolean; wastePercent: string | number }
interface ProductDetail {
  name: string; sku: string | null; barcode: string | null; categoryId: string | null; unitId: string | null;
  purchasePrice: string; salePrice: string; minStock: string; currentStock: string; productType: string; bundleType: string | null;
}

export default function ProductFormPage() {
  useLang();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { push } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [components, setComponents] = useState<BomItem[]>([]);
  const initialProductType = searchParams.get("type") === "MANUFACTURED" ? "MANUFACTURED" : "STANDARD";
  const [form, setForm] = useState({
    name: "", sku: "", barcode: "", categoryId: "", unitId: "",
    purchasePrice: 0, salePrice: 0, minStock: 0, currentStock: 0, productType: initialProductType, bundleType: "",
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [compositeDiscountPercent, setCompositeDiscountPercent] = useState(0);

  const componentPurchaseTotal = components.reduce((sum, component) => {
    const product = products.find((item) => item.id === component.componentProductId);
    return sum + (product ? Number(product.purchasePrice) * component.quantity : 0);
  }, 0);
  const componentSaleTotal = components.reduce((sum, component) => {
    const product = products.find((item) => item.id === component.componentProductId);
    return sum + (product ? Number(product.salePrice) * component.quantity : 0);
  }, 0);
  function updateCompositeDiscount(value: number) {
    const discount = Math.min(100, Math.max(0, value));
    setCompositeDiscountPercent(discount);
    setForm((current) => ({
      ...current,
      salePrice: Math.max(0, componentSaleTotal * (1 - discount / 100)),
    }));
  }

  function generateBarcode() {
    const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
    const checksum = (10 - (digits.reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0) % 10)) % 10;
    setForm((current) => ({ ...current, barcode: `${digits.join("")}${checksum}` }));
  }

  useEffect(() => {
    api.get<Category[]>("/api/store/categories").then(setCategories);
    api.get<Unit[]>("/api/store/units").then(setUnits);
    api.get<{ data: ProductOption[] }>("/api/store/products?pageSize=100").then((response) => setProducts(response.data));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api
      .get<ProductDetail>(`/api/store/products/${id}`)
      .then(async (p) => {
        setForm({
          name: p.name, sku: p.sku ?? "", barcode: p.barcode ?? "",
          categoryId: p.categoryId ?? "", unitId: p.unitId ?? "",
          purchasePrice: Number(p.purchasePrice), salePrice: Number(p.salePrice),
          minStock: Number(p.minStock), currentStock: Number(p.currentStock),
          productType: p.productType, bundleType: p.bundleType ?? "",
        });
        if (p.productType === "COMPOSITE") {
          const bom = await api.get<{ items?: BomResponseItem[] }>(`/api/store/products/${id}/bom`);
          setComponents((bom.items ?? []).map((item) => ({
            componentProductId: item.componentProductId,
            quantity: Number(item.quantity),
            isOptional: item.isOptional,
            wastePercent: Number(item.wastePercent),
          })));
        }
      })
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (form.productType === "COMPOSITE" && components.length === 0) {
      push("أضف منتجًا واحدًا على الأقل إلى مكونات الحزمة", "error");
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      categoryId: form.categoryId || undefined,
      unitId: form.unitId || undefined,
      sku: form.sku || undefined,
      barcode: form.barcode || undefined,
      bundleType: form.bundleType || undefined,
    };
    try {
      if (isEdit) {
        await api.patch(`/api/store/products/${id}`, payload);
        if (form.productType === "COMPOSITE") {
          await api.post(`/api/store/products/${id}/bom`, { items: components });
        }
        setSaved(true);
        setTimeout(() => navigate("/products"), 800);
      } else {
        const created = await api.post<{ id: string }>("/api/store/products", payload);
        if (form.productType === "COMPOSITE") {
          await api.post(`/api/store/products/${created.id}/bom`, { items: components });
        }
        setSaved(true);
        setComponents([]);
        setForm({ name: "", sku: "", barcode: "", categoryId: "", unitId: "", purchasePrice: 0, salePrice: 0, minStock: 0, currentStock: 0, productType: "STANDARD", bundleType: "" });
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err: any) {
      push(err.message || "تعذر حفظ المنتج", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-ink/50">...</p>;

  function addComponent() {
    const firstAvailable = products.find((product) => product.id !== id && !components.some((item) => item.componentProductId === product.id));
    if (!firstAvailable) return;
    setComponents((current) => [...current, { componentProductId: firstAvailable.id, quantity: 1, isOptional: false, wastePercent: 0 }]);
  }

  function updateComponent(index: number, update: Partial<BomItem>) {
    setComponents((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item));
  }

  function removeComponent(index: number) {
    setComponents((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{isEdit ? "تعديل منتج" : "إضافة منتج"}</h1>
      <form onSubmit={submit} className="bg-white border border-nile-100 rounded-lg p-4 md:p-6 space-y-3">
        <input required placeholder="اسم المنتج" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border border-nile-100 px-3 py-2" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2" />
          <div className="flex gap-2">
            <input placeholder="الباركود" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="min-w-0 flex-1 rounded-md border border-nile-100 px-3 py-2" dir="ltr" />
            <button type="button" onClick={generateBarcode} className="shrink-0 rounded-md bg-nile-700 px-3 py-2 text-xs font-bold text-paper">توليد</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value, bundleType: e.target.value === "COMPOSITE" ? form.bundleType : "" })} className="rounded-md border border-nile-100 px-3 py-2">
            <option value="STANDARD">منتج قياسي</option>
            <option value="COMPOSITE">منتج مركب</option>
            <option value="MANUFACTURED">منتج مصنع</option>
            <option value="SERVICE">خدمة</option>
          </select>
          {form.productType === "COMPOSITE" ? (
            <select value={form.bundleType} onChange={(e) => setForm({ ...form, bundleType: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2">
              <option value="">نوع المنتج المركب</option>
              <option value="VIRTUAL">حزمة افتراضية</option>
              <option value="STOCKED">حزمة مخزنة</option>
            </select>
          ) : <div />}
        </div>
        {form.productType === "COMPOSITE" && (
          <div className="rounded-md border border-nile-100 bg-nile-50 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-bold text-nile-900">منتجات الحزمة</h2>
                <p className="text-xs text-ink/60">عند بيع الحزمة الافتراضية ستُخصم هذه الكميات من مخزون مكوناتها.</p>
              </div>
              <button type="button" onClick={addComponent} className="rounded-md bg-nile-700 px-3 py-2 text-sm font-bold text-paper">+ إضافة منتج</button>
            </div>
            {components.map((component, index) => (
              <div key={`${component.componentProductId}-${index}`} className="grid grid-cols-[1fr_100px_auto] items-center gap-2">
                <select value={component.componentProductId} onChange={(event) => updateComponent(index, { componentProductId: event.target.value })} className="min-w-0 rounded-md border border-nile-100 bg-white px-3 py-2">
                  {products.filter((product) => product.id !== id && (product.id === component.componentProductId || !components.some((item) => item.componentProductId === product.id))).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                <input type="number" min={0.0001} step="0.0001" value={component.quantity} onChange={(event) => updateComponent(index, { quantity: Number(event.target.value) })} className="num rounded-md border border-nile-100 bg-white px-3 py-2" aria-label="كمية المكون" />
                <button type="button" onClick={() => removeComponent(index)} className="rounded-md px-2 py-2 text-red-700" aria-label="حذف المكون">حذف</button>
              </div>
            ))}
            {components.length === 0 && <p className="text-sm text-ink/50">لم تتم إضافة مكونات بعد. يمكنك إضافة عدد غير محدود من المنتجات.</p>}
            {components.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border-t border-nile-100 pt-3 text-sm">
                <div className="rounded-md bg-white p-2"><div className="text-ink/60">إجمالي تكلفة الشراء</div><div className="num font-black text-nile-900">{componentPurchaseTotal.toLocaleString()} SDG</div></div>
                <div className="rounded-md bg-white p-2"><div className="text-ink/60">سعر البيع الكامل</div><div className="num font-black text-nile-900">{componentSaleTotal.toLocaleString()} SDG</div></div>
                <label className="rounded-md bg-white p-2"><span className="text-ink/60">نسبة التخفيض</span><input type="number" min={0} max={100} step="0.01" value={compositeDiscountPercent} onChange={(event) => updateCompositeDiscount(Number(event.target.value))} className="num mt-1 w-full rounded border border-nile-100 px-2 py-1 font-black text-nile-900" /></label>
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2">
            <option value="">بدون تصنيف</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} className="rounded-md border border-nile-100 px-3 py-2">
            <option value="">بدون وحدة</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">سعر الشراء / التكلفة
            <input type="number" min={0} value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <label className="text-sm">سعر البيع
            <input type="number" min={0} value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: Number(e.target.value) })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
        </div>
        {form.productType !== "COMPOSITE" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">الكمية الحالية
              <input type="number" min={0} value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: Number(e.target.value) })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" disabled={isEdit} />
            </label>
            <label className="text-sm">الحد الأدنى
              <input type="number" min={0} value={form.minStock} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
            </label>
          </div>
        )}
        {isEdit && form.productType !== "COMPOSITE" && <p className="text-xs text-ink/50">الكمية الحالية تتغيّر عبر المشتريات/المبيعات/تسويات المخزون فقط، مو من هنا مباشرة.</p>}
        {saved && <p className="text-nile-700 text-sm">تم الحفظ ✅</p>}
        <button type="submit" disabled={saving} className="rounded-md bg-gold-500 text-nile-900 font-bold px-6 py-2.5 disabled:opacity-60">
          {saving ? "جارٍ الحفظ..." : "حفظ المنتج"}
        </button>
      </form>
    </div>
  );
}

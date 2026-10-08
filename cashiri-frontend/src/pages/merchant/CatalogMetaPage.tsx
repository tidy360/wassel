import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface CatalogItem { id: string; name: string }

export default function CatalogMetaPage() {
  const { push } = useToast();
  const [categories, setCategories] = useState<CatalogItem[]>([]);
  const [units, setUnits] = useState<CatalogItem[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [unitName, setUnitName] = useState("");

  function reload() {
    api.get<CatalogItem[]>("/api/store/categories").then(setCategories);
    api.get<CatalogItem[]>("/api/store/units").then(setUnits);
  }

  useEffect(reload, []);

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!categoryName.trim()) return;
    try {
      await api.post("/api/store/categories", { name: categoryName.trim() });
      setCategoryName("");
      push("تمت إضافة التصنيف", "success");
      reload();
    } catch (error: any) {
      push(error.message || "تعذر إضافة التصنيف", "error");
    }
  }

  async function addUnit(event: React.FormEvent) {
    event.preventDefault();
    if (!unitName.trim()) return;
    try {
      await api.post("/api/store/units", { name: unitName.trim() });
      setUnitName("");
      push("تمت إضافة الوحدة", "success");
      reload();
    } catch (error: any) {
      push(error.message || "تعذر إضافة الوحدة", "error");
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-black text-nile-900">التصنيفات والوحدات</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <h2 className="font-bold text-nile-900">تصنيفات المنتجات</h2>
          <form onSubmit={addCategory} className="flex gap-2">
            <input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="اسم التصنيف" className="min-w-0 flex-1 rounded-md border border-nile-100 px-3 py-2" />
            <button type="submit" className="rounded-md bg-gold-500 px-4 py-2 font-bold text-nile-900">إضافة</button>
          </form>
          <div className="space-y-2">
            {categories.map((category) => <div key={category.id} className="rounded border border-nile-50 px-3 py-2">{category.name}</div>)}
            {categories.length === 0 && <p className="text-sm text-ink/50">لا توجد تصنيفات بعد</p>}
          </div>
        </section>

        <section className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <h2 className="font-bold text-nile-900">وحدات القياس</h2>
          <form onSubmit={addUnit} className="flex gap-2">
            <input required value={unitName} onChange={(event) => setUnitName(event.target.value)} placeholder="اسم الوحدة" className="min-w-0 flex-1 rounded-md border border-nile-100 px-3 py-2" />
            <button type="submit" className="rounded-md bg-gold-500 px-4 py-2 font-bold text-nile-900">إضافة</button>
          </form>
          <div className="space-y-2">
            {units.map((unit) => <div key={unit.id} className="rounded border border-nile-50 px-3 py-2">{unit.name}</div>)}
            {units.length === 0 && <p className="text-sm text-ink/50">لا توجد وحدات بعد</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface Product { id: string; name: string; barcode: string | null; sku: string | null; salePrice: string; currentStock: string; minStock: string }

export default function ProductsPage() {
  const { t } = useLang();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");

  async function loadProducts() {
    const response = await api.get<{ data: Product[] }>(`/api/store/products?search=${encodeURIComponent(search)}&pageSize=50`);
    setProducts(response.data);
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      loadProducts().catch(() => setProducts([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  async function deleteProduct(product: Product) {
    if (!window.confirm(`هل تريد حذف المنتج "${product.name}"؟`)) return;
    setDeletingId(product.id);
    try {
      await api.post(`/api/store/products/${product.id}/deactivate`);
      await loadProducts();
    } catch (error: any) {
      window.alert(error.message || "تعذر حذف المنتج");
    } finally {
      setDeletingId(null);
    }
  }

  function startPriceEdit(product: Product) {
    setEditingPriceId(product.id);
    setPriceDraft(product.salePrice);
  }

  async function savePrice(product: Product) {
    if (editingPriceId !== product.id) return;
    const price = Number(priceDraft);
    if (!Number.isFinite(price) || price < 0) {
      window.alert("أدخل سعرًا صحيحًا");
      setPriceDraft(product.salePrice);
      return;
    }
    if (price === Number(product.salePrice)) {
      setEditingPriceId(null);
      return;
    }
    try {
      await api.patch(`/api/store/products/${product.id}`, { salePrice: price });
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, salePrice: String(price) } : item));
      setEditingPriceId(null);
    } catch (error: any) {
      window.alert(error.message || "تعذر تحديث السعر");
      setPriceDraft(product.salePrice);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-nile-900">{t("products")}</h1>
        <Link to="/products/new" className="rounded-md bg-nile-700 text-paper px-4 py-2 text-sm font-medium">+ منتج جديد</Link>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchProduct")} className="w-full max-w-sm rounded-md border border-nile-100 px-3 py-2" />

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr>
              <th className="text-start p-3">الاسم</th>
              <th className="text-start p-3">الباركود</th>
              <th className="text-start p-3">السعر</th>
              <th className="text-start p-3">المخزون</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className={`border-t border-nile-50 ${Number(p.currentStock) <= Number(p.minStock) ? "bg-gold-500/10" : ""}`}>
                <td className="p-3">{p.name}</td>
                <td className="num p-3 text-ink/60">{p.barcode || "—"}</td>
                <td className="num p-3">
                  {editingPriceId === p.id ? (
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="any"
                      value={priceDraft}
                      onChange={(e) => setPriceDraft(e.target.value)}
                      onBlur={() => void savePrice(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") { setPriceDraft(p.salePrice); setEditingPriceId(null); }
                      }}
                      className="w-28 rounded-md border border-nile-300 px-2 py-1 text-end"
                      aria-label={`تعديل سعر ${p.name}`}
                    />
                  ) : (
                    <button type="button" onClick={() => startPriceEdit(p)} className="text-nile-900 underline decoration-dotted underline-offset-4" title="تعديل السعر">
                      {Number(p.salePrice).toLocaleString()} SDG
                    </button>
                  )}
                </td>
                <td className="num p-3">{p.currentStock}</td>
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <Link to={`/products/${p.id}/edit`} className="text-nile-700 text-xs underline">تعديل</Link>
                    <button type="button" onClick={() => deleteProduct(p)} disabled={deletingId === p.id} className="text-red-700 text-xs underline disabled:opacity-50">
                      {deletingId === p.id ? "جارٍ الحذف..." : "حذف"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

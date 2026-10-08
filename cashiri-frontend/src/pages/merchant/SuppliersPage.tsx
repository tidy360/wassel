import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface Supplier { id: string; name: string; phone: string | null; balance: string }
interface Product { id: string; name: string; purchasePrice: string; salePrice: string; supplierId: string | null }

export default function SuppliersPage() {
  const { t } = useLang();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseSupplierId, setPurchaseSupplierId] = useState("");
  const [purchaseLines, setPurchaseLines] = useState<{ productId: string; quantity: number; unitPrice: number; salePrice: number }[]>([]);
  const [paidAmount, setPaidAmount] = useState(0);

  function reload() {
    api.get<Supplier[]>("/api/store/suppliers").then(setSuppliers);
    api.get<{ data: Product[] }>("/api/store/products?pageSize=500").then((result) => setProducts(result.data));
  }

  function addPurchaseLine() {
    const linkedProducts = products.filter((product) => product.supplierId === purchaseSupplierId);
    const product = linkedProducts[0] ?? products[0];
    if (!product) return;
    setPurchaseLines((lines) => [...lines, { productId: product.id, quantity: 1, unitPrice: Number(product.purchasePrice), salePrice: Number(product.salePrice) }]);
  }

  const linkedProducts = products.filter((product) => product.supplierId === purchaseSupplierId);
  const availableProducts = [
    ...linkedProducts,
    ...products.filter((product) => !linkedProducts.some((linkedProduct) => linkedProduct.id === product.id)),
  ];
  const purchaseTotal = purchaseLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const purchaseRemaining = Math.max(0, purchaseTotal - paidAmount);

  async function savePurchase() {
    if (!purchaseSupplierId || purchaseLines.length === 0) return;
    await api.post("/api/store/purchases", { supplierId: purchaseSupplierId, items: purchaseLines, paidAmount });
    setPurchaseLines([]);
    setPaidAmount(0);
    reload();
  }
  useEffect(reload, []);

  async function add() {
    if (!name.trim()) return;
    await api.post("/api/store/suppliers", { name, phone: phone || undefined });
    setName("");
    setPhone("");
    reload();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{t("suppliers")}</h1>

      <div className="flex gap-2 max-w-lg">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم المورد" className="flex-1 rounded-md border border-nile-100 px-3 py-2" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="الهاتف" className="w-36 rounded-md border border-nile-100 px-3 py-2" />
        <button onClick={add} className="rounded-md bg-nile-700 text-paper px-4 py-2 text-sm font-medium">إضافة</button>
      </div>

      <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
        <h2 className="font-bold text-nile-900">إضافة منتجات من مورد</h2>
        <select value={purchaseSupplierId} onChange={(e) => { setPurchaseSupplierId(e.target.value); setPurchaseLines([]); }} className="rounded-md border border-nile-100 px-3 py-2 w-full max-w-xs">
          <option value="">اختر المورد</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        {purchaseLines.map((line, index) => (
          <div key={index} className="flex flex-wrap gap-2 items-center">
            <label className="flex flex-col gap-1 flex-1 min-w-40 text-xs text-ink/60">المنتج
              <select value={line.productId} onChange={(e) => {
                const selectedProduct = products.find((product) => product.id === e.target.value);
                setPurchaseLines((lines) => lines.map((item, i) => i === index ? {
                  ...item,
                  productId: e.target.value,
                  unitPrice: selectedProduct ? Number(selectedProduct.purchasePrice) : item.unitPrice,
                  salePrice: selectedProduct ? Number(selectedProduct.salePrice) : item.salePrice,
                } : item));
              }} className="rounded-md border border-nile-100 px-2 py-1 text-sm text-ink">
                {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink/60">الكمية
              <input type="number" min={1} value={line.quantity} onChange={(e) => setPurchaseLines((lines) => lines.map((item, i) => i === index ? { ...item, quantity: Number(e.target.value) } : item))} className="num w-20 rounded-md border border-nile-100 px-2 py-1 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink/60">سعر الشراء
              <input type="number" min={0} value={line.unitPrice} onChange={(e) => setPurchaseLines((lines) => lines.map((item, i) => i === index ? { ...item, unitPrice: Number(e.target.value) } : item))} className="num w-28 rounded-md border border-nile-100 px-2 py-1 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink/60">سعر البيع
              <input type="number" min={0} value={line.salePrice} onChange={(e) => setPurchaseLines((lines) => lines.map((item, i) => i === index ? { ...item, salePrice: Number(e.target.value) } : item))} className="num w-28 rounded-md border border-nile-100 px-2 py-1 text-sm text-ink" />
            </label>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={addPurchaseLine} className="text-sm text-nile-700 underline">+ إضافة منتج</button>
          <label className="text-sm">المدفوع <input type="number" min={0} value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value))} className="num w-28 rounded-md border border-nile-100 px-2 py-1" /></label>
          <div className="rounded-md bg-nile-50 px-3 py-2 text-sm">
            الإجمالي المطلوب: <span className="num font-black text-nile-900">{purchaseTotal.toLocaleString()} SDG</span>
            <span className="mx-2 text-ink/40">|</span>
            المتبقي: <span className="num font-bold">{purchaseRemaining.toLocaleString()} SDG</span>
          </div>
          <button onClick={savePurchase} disabled={!purchaseSupplierId || purchaseLines.length === 0} className="rounded-md bg-gold-500 text-nile-900 px-4 py-2 text-sm font-bold disabled:opacity-50">حفظ وإضافة للمخزون</button>
        </div>
      </div>

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">الاسم</th><th className="text-start p-3">الهاتف</th><th className="text-start p-3">الرصيد المستحق</th></tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="border-t border-nile-50">
                <td className="p-3"><Link to={`/suppliers/${s.id}`} className="text-nile-700 underline">{s.name}</Link></td>
                <td className="num p-3 text-ink/60">{s.phone || "—"}</td>
                <td className="num p-3">{Number(s.balance).toLocaleString()} SDG</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface Product {
  id: string;
  name: string;
  productType: string;
  currentStock: string;
}

interface ManufacturingOrder {
  id: string;
  orderNumber: number;
  status: string;
  plannedQuantity: string;
  completedQuantity: string;
  totalCost: string;
  product: Product;
}

interface BomItem {
  componentProductId: string;
  quantity: number;
  wastePercent: number;
  isOptional: boolean;
  componentProduct?: Product;
}

export default function ManufacturingPage() {
  const { t } = useLang();
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<ManufacturingOrder[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [bomProductId, setBomProductId] = useState("");
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [componentProductId, setComponentProductId] = useState("");
  const [componentQuantity, setComponentQuantity] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const productsResponse = await api.get<{ data: Product[] }>("/api/store/products?pageSize=100");
    setProducts(productsResponse.data.filter((product) => ["COMPOSITE", "MANUFACTURED"].includes(product.productType)));
    setAllProducts(productsResponse.data);
    try {
      setOrders(await api.get<ManufacturingOrder[]>("/api/store/manufacturing-orders"));
    } catch (error: any) {
      setMessage(error.message || "تعذر تحميل أوامر التصنيع");
    }
  }

  useEffect(() => {
    if (!bomProductId) {
      setBomItems([]);
      return;
    }
    api.get<{ items?: BomItem[] }>(`/api/store/products/${bomProductId}/bom`)
      .then((bom) => setBomItems(bom.items ?? []))
      .catch((error: any) => setMessage(error.message || "تعذر تحميل BOM"));
  }, [bomProductId]);

  useEffect(() => {
    load().catch((error: any) => setMessage(error.message || "تعذر تحميل التصنيع"));
  }, []);

  async function createOrder() {
    if (!productId || quantity <= 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/api/store/manufacturing-orders", { productId, plannedQuantity: quantity, notes: notes || undefined });
      setMessage("تم إنشاء أمر التصنيع");
      setProductId("");
      setQuantity(1);
      setNotes("");
      await load();
    } catch (error: any) {
      setMessage(error.message || "تعذر إنشاء أمر التصنيع");
    } finally {
      setBusy(false);
    }
  }

  async function updateOrder(id: string, action: "reserve" | "complete") {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/api/store/manufacturing-orders/${id}/${action}`, action === "complete" ? {} : undefined);
      setMessage(action === "reserve" ? "تم حجز المكونات" : "تم إكمال التصنيع");
      await load();
    } catch (error: any) {
      setMessage(error.message || "تعذر تحديث أمر التصنيع");
    } finally {
      setBusy(false);
    }
  }

  function addBomItem() {
    if (!componentProductId || componentQuantity <= 0 || bomItems.some((item) => item.componentProductId === componentProductId)) return;
    setBomItems((items) => [...items, { componentProductId, quantity: componentQuantity, wastePercent: 0, isOptional: false }]);
    setComponentProductId("");
    setComponentQuantity(1);
  }

  async function saveBom() {
    if (!bomProductId || bomItems.length === 0) return;
    setBusy(true);
    try {
      await api.post(`/api/store/products/${bomProductId}/bom`, { items: bomItems.map(({ componentProductId: id, quantity, wastePercent, isOptional }) => ({ componentProductId: id, quantity, wastePercent, isOptional })) });
      setMessage("تم حفظ قائمة المكونات");
    } catch (error: any) {
      setMessage(error.message || "تعذر حفظ BOM");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-nile-900">{t("manufacturing")}</h1>
            <p className="text-sm text-ink/60 mt-1">{t("manufacturingDescription")}</p>
          </div>
          <Link to="/products/new?type=MANUFACTURED" className="rounded-md bg-gold-500 px-4 py-2 text-sm font-bold text-nile-900">
            + {t("addManufacturedProduct")}
          </Link>
        </div>
      </div>

      <section className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
        <h2 className="font-bold text-lg">{t("newManufacturingOrder")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={productId} onChange={(event) => setProductId(event.target.value)} className="rounded-md border border-nile-100 px-3 py-2">
            <option value="">{t("selectManufacturedProduct")}</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="rounded-md border border-nile-100 px-3 py-2 num" placeholder={t("quantity")} />
          <input value={notes} onChange={(event) => setNotes(event.target.value)} className="rounded-md border border-nile-100 px-3 py-2" placeholder={t("optionalNotes")} />
        </div>
        <button disabled={busy || !productId} onClick={createOrder} className="rounded-md bg-gold-500 px-4 py-2 font-bold text-nile-900 disabled:opacity-50">{t("createManufacturingOrder")}</button>
      </section>

      <section className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
        <h2 className="font-bold text-lg">{t("bomList")}</h2>
        <select value={bomProductId} onChange={(event) => setBomProductId(event.target.value)} className="w-full rounded-md border border-nile-100 px-3 py-2">
          <option value="">{t("selectManufacturedProduct")}</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        {bomProductId && <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select value={componentProductId} onChange={(event) => setComponentProductId(event.target.value)} className="rounded-md border border-nile-100 px-3 py-2">
              <option value="">{t("selectComponent")}</option>
              {allProducts.filter((product) => product.id !== bomProductId).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            <input type="number" min={0.0001} step="0.0001" value={componentQuantity} onChange={(event) => setComponentQuantity(Number(event.target.value))} className="rounded-md border border-nile-100 px-3 py-2 num" />
            <button type="button" onClick={addBomItem} className="rounded-md border border-nile-200 px-3 py-2">{t("addComponent")}</button>
          </div>
          <div className="space-y-1">
            {bomItems.map((item) => <div key={item.componentProductId} className="flex items-center justify-between rounded bg-nile-50 px-3 py-2 text-sm">
              <span>{item.componentProduct?.name ?? allProducts.find((product) => product.id === item.componentProductId)?.name ?? item.componentProductId}</span>
              <span className="num">{item.quantity}</span>
            </div>)}
          </div>
          <button disabled={busy || bomItems.length === 0} onClick={saveBom} className="rounded-md bg-nile-700 px-4 py-2 text-paper disabled:opacity-50">{t("saveBom")}</button>
        </>}
      </section>

      {message && <p className="rounded-md bg-nile-50 px-3 py-2 text-sm text-nile-800">{message}</p>}

      <section className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr>
              <th className="text-start p-3">{t("manufacturingNumber")}</th>
              <th className="text-start p-3">المنتج</th>
              <th className="text-start p-3">{t("planned")}</th>
              <th className="text-start p-3">{t("completed")}</th>
              <th className="text-start p-3">{t("status")}</th>
              <th className="text-start p-3">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-nile-50">
                <td className="p-3 num">#{order.orderNumber}</td>
                <td className="p-3 font-medium">{order.product.name}</td>
                <td className="p-3 num">{Number(order.plannedQuantity).toLocaleString()}</td>
                <td className="p-3 num">{Number(order.completedQuantity).toLocaleString()}</td>
                <td className="p-3">{({ DRAFT: t("draft"), IN_PROGRESS: t("inProgress"), PARTIALLY_COMPLETED: t("partiallyCompleted"), CANCELLED: t("cancelled"), PLANNED: t("planned"), COMPLETED: t("completed") } as Record<string, string>)[order.status] ?? order.status}</td>
                <td className="p-3 flex gap-2">
                  {order.status === "DRAFT" && <button disabled={busy} onClick={() => updateOrder(order.id, "reserve")} className="rounded border border-nile-200 px-2 py-1 text-xs">{t("reserve")}</button>}
                  {!["COMPLETED", "CANCELLED"].includes(order.status) && <button disabled={busy} onClick={() => updateOrder(order.id, "complete")} className="rounded bg-nile-700 px-2 py-1 text-xs text-paper">{t("finish")}</button>}
                </td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-ink/50">{t("noManufacturingOrders")}</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

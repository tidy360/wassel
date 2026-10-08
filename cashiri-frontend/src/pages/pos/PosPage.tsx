import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useLang } from "../../i18n";
import BarcodeScanner from "../../components/BarcodeScanner";
import { queueSale, flushQueue, pendingCount } from "../../lib/offlineQueue";

type ConnectionStatus = "online" | "offline" | "syncing" | "synced";

interface Product {
  id: string;
  name: string;
  barcode: string | null;
  sku: string | null;
  salePrice: string;
  currentStock: string;
}
interface PaymentMethod {
  id: string;
  name: string;
  code: string;
  requiresAttachment: boolean;
}
interface Tax { id: string; rate: string; isEnabled: boolean }
interface CashSession {
  id: string;
  openingCash: string;
  openedAt: string;
}
interface CartLine {
  product: Product;
  quantity: number;
  discount: number;
}
interface Customer { id: string; name: string; phone: string | null }

export default function PosPage() {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [applyTax, setApplyTax] = useState(true);
  const [taxRate, setTaxRate] = useState(0);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [saleMode, setSaleMode] = useState<"cash" | "installment">("cash");
  const [downPayment, setDownPayment] = useState(0);
  const [profitPercent, setProfitPercent] = useState(0);
  const [installmentMonths, setInstallmentMonths] = useState(2);
  const [installmentNotes, setInstallmentNotes] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [scanning, setScanning] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [openingCash, setOpeningCash] = useState(0);
  const [actualCash, setActualCash] = useState(0);
  const [cashActionLoading, setCashActionLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() => navigator.onLine ? "online" : "offline");
  const [pendingOperations, setPendingOperations] = useState(() => pendingCount());

  useEffect(() => {
    api.get<PaymentMethod[]>("/api/store/settings/payment-methods").then((methods) => {
      setPaymentMethods(methods);
      setSelectedMethod(methods.find((m) => m.code === "cash") ?? methods[0] ?? null);
    }).catch((err: any) => setMessage(err.message || "تعذر تحميل طرق الدفع"));
    api.get<Tax[]>("/api/store/settings/taxes").then((taxes) => {
      setTaxRate(Number(taxes.find((tax) => tax.isEnabled)?.rate ?? 0));
    }).catch(() => setTaxRate(0));
    api.get<Customer[]>("/api/store/customers").then(setCustomers).catch((err: any) => setMessage(err.message || "تعذر تحميل العملاء"));
    api.get<CashSession | null>("/api/store/cash-sessions/current").then(setCashSession).catch((err: any) => setMessage(err.message || "تعذر التحقق من حالة الصندوق"));

    async function syncPending() {
      if (!navigator.onLine) {
        setConnectionStatus("offline");
        return;
      }

      setConnectionStatus("syncing");
      try {
        const result = await flushQueue();
        setPendingOperations(pendingCount());
        if (result.applied > 0) setMessage(`تمت مزامنة ${result.applied} عملية معلّقة`);
        setConnectionStatus("synced");
      } catch {
        setPendingOperations(pendingCount());
        setConnectionStatus(navigator.onLine ? "online" : "offline");
      }
    }

    const onOnline = () => { void syncPending(); };
    const onOffline = () => setConnectionStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void syncPending();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function openCashRegister() {
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      setMessage("أدخل رصيدًا افتتاحيًا صحيحًا");
      return;
    }
    setCashActionLoading(true);
    try {
      const session = await api.post<CashSession>("/api/store/cash-sessions/open", { openingCash });
      setCashSession(session);
      setOpeningCash(0);
      setMessage("تم فتح الصندوق ويمكنك الآن إتمام البيع");
    } catch (err: any) {
      setMessage(err.message || "تعذر فتح الصندوق");
    } finally {
      setCashActionLoading(false);
    }
  }

  async function closeCashRegister() {
    if (!cashSession) return;
    setCashActionLoading(true);
    try {
      await api.post(`/api/store/cash-sessions/${cashSession.id}/close`, { actualCash });
      setCashSession(null);
      setActualCash(0);
      setMessage("تم إغلاق الصندوق");
    } catch (err: any) {
      setMessage(err.message || "تعذر إغلاق الصندوق");
    } finally {
      setCashActionLoading(false);
    }
  }

  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const handle = setTimeout(() => {
      api.get<{ data: Product[] }>(`/api/store/products?search=${encodeURIComponent(search)}&pageSize=10`).then((r) => setResults(r.data));
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  async function addByBarcode(code: string) {
    setScanning(false);
    try {
      const product = await api.get<Product>(`/api/store/products/barcode/${encodeURIComponent(code)}`);
      addToCart(product);
    } catch {
      setMessage("لم يتم العثور على منتج بهذا الباركود");
    }
  }

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) return prev.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { product, quantity: 1, discount: 0 }];
    });
    setSearch("");
    setResults([]);
  }

  function updateQty(productId: string, qty: number) {
    if (qty <= 0) return setCart((prev) => prev.filter((l) => l.product.id !== productId));
    setCart((prev) => prev.map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l)));
  }

  const subtotal = cart.reduce((sum, l) => sum + Number(l.product.salePrice) * l.quantity - l.discount, 0);
  const taxableTotal = Math.max(0, subtotal - invoiceDiscount);
  const taxTotal = applyTax ? taxableTotal * taxRate / 100 : 0;
  const total = taxableTotal + taxTotal;
  const installmentTotal = total * (1 + profitPercent / 100);
  const matchingCustomers = customers.filter((customer) => {
    const query = customerSearch.trim().toLowerCase();
    return !query || customer.name.toLowerCase().includes(query) || (customer.phone ?? "").toLowerCase().includes(query);
  });

  async function completeSale() {
    if (cart.length === 0 || !selectedMethod) return;
    if (!cashSession) { setMessage("افتح الصندوق أولاً قبل إتمام البيع"); return; }
    if (saleMode === "installment" && !customerId) { setMessage("اختر العميل أولاً للتقسيط"); return; }
    if (saleMode === "installment" && downPayment > installmentTotal) { setMessage("الدفعة الأولى لا يمكن أن تتجاوز إجمالي التقسيط"); return; }
    setSubmitting(true);
    setMessage(null);

    let attachmentUrl: string | undefined;
    try {
      if (selectedMethod.requiresAttachment && receiptFile) {
        const base64 = await fileToBase64(receiptFile);
        const uploaded = await api.post<{ signedUrl: string }>("/api/store/files", {
          fileName: receiptFile.name,
          mimeType: receiptFile.type,
          base64Data: base64,
        });
        attachmentUrl = uploaded.signedUrl;
      }

      const payload = {
        items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPrice: Number(l.product.salePrice), discount: l.discount })),
        discount: invoiceDiscount,
        applyTax,
        customerId: customerId || undefined,
        paymentMethodId: selectedMethod.id,
        attachmentUrl,
        installment: saleMode === "installment" ? { customerId, downPayment, months: installmentMonths, profitPercent, notes: installmentNotes || undefined } : undefined,
      };

      if (navigator.onLine) {
        await api.post("/api/store/sales", payload);
        setConnectionStatus("online");
        setMessage("تم إتمام البيع ✅");
      } else {
        queueSale(payload);
        setPendingOperations(pendingCount());
        setConnectionStatus("offline");
        setMessage("لا يوجد اتصال — تم حفظ الفاتورة محلياً وستتم المزامنة تلقائياً");
      }

      setCart([]);
      setInvoiceDiscount(0);
      setApplyTax(true);
      setReceiptFile(null);
      setCustomerId("");
      setCustomerSearch("");
      setSaleMode("cash");
      setDownPayment(0);
      setProfitPercent(0);
      setInstallmentNotes("");
    } catch (err: any) {
      // Even ON-line submission can fail mid-flight (dropped connection); fall back to the offline queue rather than lose the sale.
      if (!navigator.onLine) {
        queueSale({ items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPrice: Number(l.product.salePrice), discount: l.discount })), discount: invoiceDiscount, applyTax, paymentMethodId: selectedMethod.id });
        setPendingOperations(pendingCount());
        setConnectionStatus("offline");
        setMessage("تم حفظ الفاتورة محلياً لحين عودة الاتصال");
        setCart([]);
      } else {
        setMessage(err.message || "تعذر إتمام البيع");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function addCustomer() {
    if (!newCustomer.name.trim()) { setMessage("اكتب اسم العميل أولاً"); return; }
    setAddingCustomer(true);
    try {
      const customer = await api.post<Customer>("/api/store/customers", { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() || undefined });
      setCustomers((prev) => [...prev, customer].sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(customer.id);
      setCustomerSearch(`${customer.name}${customer.phone ? ` — ${customer.phone}` : ""}`);
      setNewCustomer({ name: "", phone: "" });
      setShowCustomerForm(false);
      setMessage("تمت إضافة العميل واختياره ✅");
    } catch (err: any) {
      setMessage(err.message || "تعذر إضافة العميل");
    } finally {
      setAddingCustomer(false);
    }
  }

  if (!cashSession) {
    return (
      <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center">
        <div className="w-full max-w-xl rounded-xl border border-gold-500/50 bg-gold-50 p-6 text-center shadow-sm md:p-10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gold-500 text-3xl">💰</div>
          <h1 className="text-2xl font-black text-nile-900">{t("cashClosed")}</h1>
          <p className="mt-2 text-sm text-ink/60">{t("openingCashRequired")}</p>
          <label className="mx-auto mt-6 block max-w-sm text-start text-sm font-medium">{t("openingBalance")}
            <input
              type="number"
              min={0}
              value={openingCash}
              onChange={(e) => setOpeningCash(Number(e.target.value))}
              className="num mt-1 w-full rounded-md border border-nile-100 bg-white px-3 py-3 text-lg"
            />
          </label>
          <button type="button" onClick={openCashRegister} disabled={cashActionLoading} className="mt-5 rounded-md bg-gold-500 px-8 py-3 font-bold text-nile-900 disabled:opacity-60">
            {cashActionLoading ? "..." : t("openCash")}
          </button>
          {message && <p className="mt-4 text-sm text-danger">{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
      {scanning && <BarcodeScanner onDetected={addByBarcode} onClose={() => setScanning(false)} />}

      <div className="lg:col-span-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-nile-100 bg-white px-3 py-2 text-sm">
        <span className="font-semibold text-nile-900">
          {connectionStatus === "online" && "🟢 متصل"}
          {connectionStatus === "offline" && "🟠 غير متصل"}
          {connectionStatus === "syncing" && "🔄 جاري المزامنة"}
          {connectionStatus === "synced" && "✅ تمت المزامنة"}
        </span>
        <span className="text-ink/60">عمليات معلّقة: <span className="num font-bold">{pendingOperations}</span></span>
      </div>

      <div className={`lg:col-span-3 rounded-md border p-3 ${cashSession ? "border-nile-100 bg-white" : "border-gold-500/50 bg-gold-50"}`}>
        {!cashSession ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-52">
              <div className="font-bold text-nile-900">{t("cashClosed")}</div>
              <label className="mt-1 block text-sm">{t("openingBalance")}
                <input type="number" min={0} value={openingCash} onChange={(e) => setOpeningCash(Number(e.target.value))} className="num mt-1 w-full rounded-md border border-nile-100 px-3 py-2" />
              </label>
            </div>
            <button type="button" onClick={openCashRegister} disabled={cashActionLoading} className="rounded-md bg-gold-500 px-4 py-2 font-bold text-nile-900 disabled:opacity-60">
              {cashActionLoading ? "..." : t("openCash")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="text-sm">
              <div className="font-bold text-nile-900">{t("cashOpen")}</div>
              <div className="text-ink/60">{t("openingBalance")}: <span className="num">{Number(cashSession.openingCash).toLocaleString()} SDG</span> {new Date(cashSession.openedAt).toLocaleTimeString()}</div>
            </div>
            <div className="flex items-end gap-2">
              <label className="text-sm">{t("actualCash")}
                <input type="number" min={0} value={actualCash} onChange={(e) => setActualCash(Number(e.target.value))} className="num mt-1 w-40 rounded-md border border-nile-100 px-3 py-2" />
              </label>
              <button type="button" onClick={closeCashRegister} disabled={cashActionLoading} className="rounded-md bg-nile-700 px-4 py-2 font-bold text-paper disabled:opacity-60">
                {cashActionLoading ? "..." : t("closeCash")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search / product results */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex gap-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchProduct")}
            className="flex-1 rounded-md border border-nile-100 px-4 py-3 text-lg outline-none focus:border-nile-500"
          />
          <button onClick={() => setScanning(true)} className="shrink-0 rounded-md bg-nile-700 text-paper px-4 py-3 text-xl" aria-label={t("scanBarcode")}>
            📷
          </button>
        </div>

        {results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="rounded-md border border-nile-100 bg-white p-3 text-start hover:border-nile-500 transition-colors"
              >
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="num text-nile-700 font-bold">{Number(p.salePrice).toLocaleString()} SDG</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart */}
      <div className="bg-white border border-nile-100 rounded-lg p-4 flex flex-col h-full">
        <h2 className="font-bold text-lg mb-3">{t("cart")}</h2>

        <div className="flex-1 overflow-y-auto space-y-2 mb-3">
          {cart.map((line) => (
            <div key={line.product.id} className="flex items-center justify-between gap-2 border-b border-nile-50 pb-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{line.product.name}</div>
                <div className="num text-xs text-ink/60">{Number(line.product.salePrice).toLocaleString()} × {line.quantity}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => updateQty(line.product.id, line.quantity - 1)} className="h-8 w-8 rounded bg-nile-50 font-bold">−</button>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value > 0) updateQty(line.product.id, value);
                  }}
                  onBlur={(event) => {
                    if (!event.target.value || Number(event.target.value) <= 0) updateQty(line.product.id, 1);
                  }}
                  className="num w-14 rounded border border-nile-100 px-1 text-center"
                  aria-label={`كمية ${line.product.name}`}
                />
                <button onClick={() => updateQty(line.product.id, line.quantity + 1)} className="h-8 w-8 rounded bg-nile-50 font-bold">+</button>
              </div>
            </div>
          ))}
          {cart.length === 0 && <p className="text-ink/40 text-sm text-center py-8">السلة فارغة</p>}
        </div>

        <div className="space-y-2 border-t border-nile-100 pt-3">
          <div className="flex gap-2">
            <button onClick={() => setSaleMode("cash")} className={`flex-1 rounded-md py-2 text-sm font-medium border ${saleMode === "cash" ? "bg-nile-700 text-paper border-nile-700" : "border-nile-100"}`}>بيع نقدي</button>
            <button onClick={() => setSaleMode("installment")} className={`flex-1 rounded-md py-2 text-sm font-medium border ${saleMode === "installment" ? "bg-nile-700 text-paper border-nile-700" : "border-nile-100"}`}>تقسيط للعميل</button>
          </div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                value={customerSearch}
                onChange={(event) => {
                  setCustomerSearch(event.target.value);
                  setCustomerId("");
                }}
                placeholder={saleMode === "installment" ? "ابحث باسم أو رقم العميل" : "عميل اختياري: ابحث بالاسم أو الرقم"}
                className="w-full rounded-md border border-nile-100 px-3 py-2 text-sm"
              />
              {customerSearch.trim() && !customerId && matchingCustomers.length > 0 && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-nile-100 bg-white shadow-lg">
                  {matchingCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => {
                        setCustomerId(customer.id);
                        setCustomerSearch(`${customer.name}${customer.phone ? ` — ${customer.phone}` : ""}`);
                      }}
                      className="block w-full px-3 py-2 text-start text-sm hover:bg-nile-50"
                    >
                      {customer.name}{customer.phone ? ` — ${customer.phone}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setShowCustomerForm((visible) => !visible)} className="shrink-0 rounded-md bg-nile-700 px-3 py-2 text-sm font-bold text-paper">+ عميل</button>
          </div>
          {saleMode === "installment" && customers.length === 0 && <button type="button" onClick={() => setShowCustomerForm(true)} className="w-full rounded-md border border-nile-100 px-3 py-2 text-sm text-nile-700">إضافة أول عميل</button>}
          {showCustomerForm && <div className="space-y-2 rounded-md border border-nile-100 bg-white p-3">
            <input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} placeholder="اسم العميل" className="w-full rounded border border-nile-100 px-2 py-1 text-sm" />
            <input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} placeholder="رقم الهاتف (اختياري)" className="w-full rounded border border-nile-100 px-2 py-1 text-sm" dir="ltr" />
            <button type="button" disabled={addingCustomer} onClick={addCustomer} className="rounded bg-gold-500 px-3 py-1 text-sm font-bold disabled:opacity-60">{addingCustomer ? "جارٍ الإضافة..." : "حفظ العميل"}</button>
          </div>}
          {saleMode === "installment" && <div className="space-y-2 rounded-md bg-nile-50 p-3">
            <label className="block text-sm">نسبة ربح التقسيط (%)
              <input type="number" min={0} max={1000} step="0.01" value={profitPercent} onChange={(e) => setProfitPercent(Number(e.target.value))} className="num mt-1 w-full rounded border border-nile-100 px-2 py-1" />
            </label>
            <label className="block text-sm">الدفعة الأولى
              <input type="number" min={0} max={total * (1 + profitPercent / 100)} value={downPayment} onChange={(e) => setDownPayment(Number(e.target.value))} className="num mt-1 w-full rounded border border-nile-100 px-2 py-1" />
            </label>
            <label className="block text-sm">خطة السداد
              <select value={installmentMonths} onChange={(e) => setInstallmentMonths(Number(e.target.value))} className="mt-1 w-full rounded border border-nile-100 px-2 py-1">
                {[2, 4, 6, 12].map((months) => <option key={months} value={months}>{months === 12 ? "سنة" : `${months} أشهر`}</option>)}
              </select>
            </label>
            <div className="text-sm space-y-1"><div>الإجمالي بعد الربح: <span className="num font-bold">{installmentTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} SDG</span></div><div>المتبقي: <span className="num font-bold">{Math.max(0, installmentTotal - downPayment).toLocaleString(undefined, { maximumFractionDigits: 2 })} SDG</span>، القسط التقريبي: <span className="num font-bold">{((Math.max(0, installmentTotal - downPayment)) / installmentMonths).toLocaleString(undefined, { maximumFractionDigits: 2 })} SDG</span></div></div>
            <textarea value={installmentNotes} onChange={(e) => setInstallmentNotes(e.target.value)} placeholder="ملاحظات التقسيط" className="w-full rounded border border-nile-100 px-2 py-1 text-sm" rows={2} />
          </div>}
          <div className="flex justify-between text-sm">
            <span>{t("discount")}</span>
            <input
              type="number"
              min={0}
              value={invoiceDiscount}
              onChange={(e) => setInvoiceDiscount(Number(e.target.value))}
              className="num w-24 rounded border border-nile-100 px-2 py-1 text-end"
            />
          </div>
          <label className="flex items-center justify-between rounded-md bg-nile-50 px-3 py-2 text-sm">
            <span>إضافة الضريبة ({taxRate}%)</span>
            <input type="checkbox" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} />
          </label>
          {applyTax && taxRate > 0 && <div className="flex justify-between text-sm text-ink/60"><span>قيمة الضريبة</span><span className="num">{taxTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} SDG</span></div>}
          <div className="flex justify-between font-black text-xl text-nile-900">
            <span>{t("total")}</span>
            <span className="num">{total.toLocaleString()} SDG</span>
          </div>

          <div className="flex gap-2 pt-1">
            {paymentMethods.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMethod(m)}
                className={`flex-1 rounded-md py-2 text-sm font-medium border ${selectedMethod?.id === m.id ? "bg-nile-700 text-paper border-nile-700" : "border-nile-100"}`}
              >
                {m.name}
              </button>
            ))}
          </div>

          {selectedMethod?.requiresAttachment && (
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          )}

          {message && <p className="text-sm text-nile-700">{message}</p>}

          <button
            onClick={completeSale}
            disabled={cart.length === 0 || submitting || !cashSession}
            className="w-full rounded-md bg-gold-500 text-nile-900 font-black py-3 text-lg disabled:opacity-50"
          >
            {submitting ? "..." : t("completeSale")}
          </button>
          {!cashSession && <p className="text-xs text-danger text-center">افتح الصندوق أولاً لتفعيل البيع</p>}
          {cart.length === 0 && <p className="text-xs text-ink/50 text-center">أضف منتجًا إلى السلة لإتمام البيع</p>}
        </div>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

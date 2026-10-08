import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface Purchase { id: string; total: string; paidAmount: string; createdAt: string }
interface Product { id: string; name: string; purchasePrice: string }
interface Supplier { id: string; name: string }
interface Expense { id: string; name: string; category: string | null; amount: string; description: string | null; createdAt: string }

const expenseCategories = ["رواتب", "كهرباء", "فطور", "مواصلات", "إيجار", "صيانة", "اتصالات", "أخرى"];

export default function PurchasesPage() {
  const { t } = useLang();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: number; unitPrice: number }[]>([]);
  const [paidAmount, setPaidAmount] = useState(0);
  const [expenseName, setExpenseName] = useState("");
  const [expenseCategory, setExpenseCategory] = useState(expenseCategories[0]);
  const [customExpenseCategory, setCustomExpenseCategory] = useState("");
  const [expenseAmount, setExpenseAmount] = useState(0);
  const [expenseDescription, setExpenseDescription] = useState("");

  function reload() {
    api.get<{ data: Purchase[] }>("/api/store/purchases?pageSize=50").then((r) => setPurchases(r.data));
    api.get<Expense[]>("/api/store/expenses").then(setExpenses);
  }

  useEffect(() => {
    reload();
    api.get<{ data: Product[] }>("/api/store/products?pageSize=200").then((r) => setProducts(r.data));
    api.get<Supplier[]>("/api/store/suppliers").then(setSuppliers);
  }, []);

  function addLine() {
    if (products.length === 0) return;
    setLines((prev) => [...prev, { productId: products[0].id, quantity: 1, unitPrice: Number(products[0].purchasePrice) }]);
  }

  async function submit() {
    if (lines.length === 0) return;
    await api.post("/api/store/purchases", { supplierId: supplierId || undefined, items: lines, paidAmount });
    setShowForm(false);
    setLines([]);
    setPaidAmount(0);
    reload();
  }

  async function submitExpense() {
    const category = expenseCategory === "أخرى" ? customExpenseCategory.trim() : expenseCategory;
    if (!expenseName.trim() || !category || expenseAmount <= 0) return;
    await api.post("/api/store/expenses", {
      name: expenseName.trim(),
      category,
      amount: expenseAmount,
      description: expenseDescription.trim() || undefined,
    });
    setExpenseName("");
    setExpenseCategory(expenseCategories[0]);
    setCustomExpenseCategory("");
    setExpenseAmount(0);
    setExpenseDescription("");
    setShowExpenseForm(false);
    api.get<Expense[]>("/api/store/expenses").then(setExpenses);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-nile-900">{t("purchases")}</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowExpenseForm((s) => !s)} className="rounded-md bg-gold-500 text-nile-900 px-4 py-2 text-sm font-bold">{showExpenseForm ? "إلغاء" : "+ مصروف جديد"}</button>
          <button onClick={() => setShowForm((s) => !s)} className="rounded-md bg-nile-700 text-paper px-4 py-2 text-sm font-medium">{showForm ? "إلغاء" : "+ فاتورة شراء جديدة"}</button>
        </div>
      </div>

      {showExpenseForm && (
        <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <h2 className="font-bold text-lg">إضافة مصروف</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required value={expenseName} onChange={(e) => setExpenseName(e.target.value)} placeholder="اسم المصروف، مثل راتب موظف" className="rounded-md border border-nile-100 px-3 py-2" />
            <input type="number" min={0} value={expenseAmount} onChange={(e) => setExpenseAmount(Number(e.target.value))} placeholder="المبلغ" className="num rounded-md border border-nile-100 px-3 py-2" />
            <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} className="rounded-md border border-nile-100 px-3 py-2">
              {expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            {expenseCategory === "أخرى" && <input value={customExpenseCategory} onChange={(e) => setCustomExpenseCategory(e.target.value)} placeholder="اكتب نوع المصروف" className="rounded-md border border-nile-100 px-3 py-2" />}
          </div>
          <textarea value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)} placeholder="ملاحظات اختيارية" rows={2} className="w-full rounded-md border border-nile-100 px-3 py-2" />
          <button onClick={submitExpense} disabled={!expenseName.trim() || expenseAmount <= 0 || (expenseCategory === "أخرى" && !customExpenseCategory.trim())} className="rounded-md bg-gold-500 text-nile-900 font-bold px-4 py-2 disabled:opacity-50">حفظ المصروف</button>
        </div>
      )}

      {showForm && (
        <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-md border border-nile-100 px-3 py-2 w-full max-w-xs">
            <option value="">بدون مورد</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {lines.map((line, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <select
                value={line.productId}
                onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, productId: e.target.value } : l)))}
                className="rounded-md border border-nile-100 px-2 py-1 flex-1"
              >
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="number" min={1} value={line.quantity} onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity: Number(e.target.value) } : l)))} className="num w-20 rounded-md border border-nile-100 px-2 py-1" />
              <input type="number" min={0} value={line.unitPrice} onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, unitPrice: Number(e.target.value) } : l)))} className="num w-24 rounded-md border border-nile-100 px-2 py-1" />
            </div>
          ))}
          <button onClick={addLine} className="text-sm text-nile-700 underline">+ إضافة صنف</button>

          <div className="flex items-center gap-2">
            <span className="text-sm">المبلغ المدفوع</span>
            <input type="number" min={0} value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value))} className="num w-32 rounded-md border border-nile-100 px-2 py-1" />
          </div>

          <button onClick={submit} className="rounded-md bg-gold-500 text-nile-900 font-bold px-4 py-2">حفظ فاتورة الشراء</button>
        </div>
      )}

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">التاريخ</th><th className="text-start p-3">الإجمالي</th><th className="text-start p-3">المدفوع</th></tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className="border-t border-nile-50">
                <td className="num p-3 text-ink/60"><Link to={`/purchases/${p.id}`} className="text-nile-700 underline">{new Date(p.createdAt).toLocaleDateString("ar-SD")}</Link></td>
                <td className="num p-3">{Number(p.total).toLocaleString()} SDG</td>
                <td className="num p-3">{Number(p.paidAmount).toLocaleString()} SDG</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-black text-nile-900">المصروفات</h2>
        <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-nile-50 text-ink/70"><tr><th className="text-start p-3">التاريخ</th><th className="text-start p-3">المصروف</th><th className="text-start p-3">التصنيف</th><th className="text-start p-3">المبلغ</th><th className="text-start p-3">الملاحظات</th></tr></thead>
            <tbody>
              {expenses.map((expense) => <tr key={expense.id} className="border-t border-nile-50"><td className="num p-3">{new Date(expense.createdAt).toLocaleDateString("ar-SD")}</td><td className="p-3">{expense.name}</td><td className="p-3">{expense.category || "—"}</td><td className="num p-3">{Number(expense.amount).toLocaleString()} SDG</td><td className="p-3 text-ink/60">{expense.description || "—"}</td></tr>)}
              {expenses.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink/50">لا توجد مصروفات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

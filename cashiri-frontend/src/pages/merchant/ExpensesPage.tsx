import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface Expense {
  id: string;
  name: string;
  category: string | null;
  amount: string;
  description: string | null;
  createdAt: string;
  paymentMethodId: string | null;
  expenseType: "one_time" | "recurring" | "fixed";
  recurrencePeriod: string | null;
}

interface PaymentMethod { id: string; name: string; code: string }

const categories = ["رواتب", "كهرباء", "فطور", "مواصلات", "إيجار", "صيانة", "اتصالات", "أخرى"];

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [expenseType, setExpenseType] = useState<"one_time" | "recurring" | "fixed">("one_time");
  const [recurrencePeriod, setRecurrencePeriod] = useState("daily");
  const [selectedRecurringId, setSelectedRecurringId] = useState("");
  const [view, setView] = useState<"all" | "recurring">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      setExpenses(await api.get<Expense[]>("/api/store/expenses"));
    } catch (error: any) {
      setMessage(error.message || "تعذر تحميل المصروفات");
    }
  }

  useEffect(() => {
    void load();
    api.get<PaymentMethod[]>("/api/store/settings/payment-methods").then((methods) => {
      setPaymentMethods(methods);
      if (methods[0]) setPaymentMethodId(methods[0].id);
    }).catch(() => undefined);
  }, []);

  async function saveExpense() {
    const selectedCategory = category === "أخرى" ? customCategory.trim() : category;
    if (!name.trim() || amount <= 0 || !selectedCategory) {
      setMessage("أدخل اسم المصروف والتصنيف والمبلغ");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api.post("/api/store/expenses", {
        name: name.trim(),
        category: selectedCategory,
        amount,
        expenseType,
        recurrencePeriod: expenseType === "one_time" ? undefined : recurrencePeriod,
        paymentMethodId: paymentMethodId || undefined,
        description: description.trim() || undefined,
      });
      setName("");
      setCategory(categories[0]);
      setCustomCategory("");
      setAmount(0);
      setExpenseType("one_time");
      setRecurrencePeriod("daily");
      setSelectedRecurringId("");
      setPaymentMethodId(paymentMethods[0]?.id ?? "");
      setDescription("");
      setShowForm(false);
      setMessage("تم حفظ المصروف");
      await load();
    } catch (error: any) {
      setMessage(error.message || "تعذر حفظ المصروف");
    } finally {
      setSaving(false);
    }
  }

  function selectRecurringExpense(id: string) {
    setSelectedRecurringId(id);
    const expense = expenses.find((item) => item.id === id);
    if (!expense) return;
    setName(expense.name);
    setAmount(Number(expense.amount));
    setDescription(expense.description ?? "");
    setRecurrencePeriod(expense.recurrencePeriod ?? "daily");
    setPaymentMethodId(expense.paymentMethodId ?? paymentMethods[0]?.id ?? "");
    if (categories.includes(expense.category ?? "")) {
      setCategory(expense.category ?? categories[0]);
      setCustomCategory("");
    } else {
      setCategory("أخرى");
      setCustomCategory(expense.category ?? "");
    }
  }

  async function updateAmount(expense: Expense) {
    if (editingAmount <= 0) return;
    try {
      await api.patch(`/api/store/expenses/${expense.id}`, { amount: editingAmount });
      setEditingId(null);
      await load();
      setMessage("تم تعديل مبلغ المصروف");
    } catch (error: any) {
      setMessage(error.message || "تعذر تعديل المصروف");
    }
  }

  async function deleteExpense(expense: Expense) {
    if (!window.confirm(`حذف المصروف "${expense.name}"؟`)) return;
    try {
      await api.delete(`/api/store/expenses/${expense.id}`);
      setMessage("تم حذف المصروف");
      await load();
    } catch (error: any) {
      setMessage(error.message || "تعذر حذف المصروف");
    }
  }

  const visibleExpenses = view === "recurring" ? expenses.filter((expense) => expense.expenseType === "recurring") : expenses;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black text-nile-900">المصروفات</h1>
        <button type="button" onClick={() => setShowForm((visible) => !visible)} className="rounded-md bg-gold-500 px-4 py-2 text-sm font-bold text-nile-900">
          {showForm ? "إلغاء" : "+ مصروف جديد"}
        </button>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setView("all")} className={`rounded-md border px-3 py-2 text-sm ${view === "all" ? "border-nile-700 bg-nile-700 text-paper" : "border-nile-100 bg-white"}`}>كل المصروفات</button>
        <button type="button" onClick={() => setView("recurring")} className={`rounded-md border px-3 py-2 text-sm ${view === "recurring" ? "border-nile-700 bg-nile-700 text-paper" : "border-nile-100 bg-white"}`}>المصاريف المتكررة</button>
      </div>

      {showForm && (
        <section className="max-w-2xl rounded-lg border border-nile-100 bg-white p-4 space-y-3">
          <h2 className="text-lg font-bold">إضافة مصروف</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم المصروف، مثل راتب موظف" className="rounded-md border border-nile-100 px-3 py-2" />
            <input type="number" min={0} value={amount} onChange={(event) => setAmount(Number(event.target.value))} placeholder="المبلغ" className="num rounded-md border border-nile-100 px-3 py-2" />
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-md border border-nile-100 px-3 py-2">
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {category === "أخرى" && <input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="اكتب نوع المصروف" className="rounded-md border border-nile-100 px-3 py-2" />}
            <select value={expenseType} onChange={(event) => setExpenseType(event.target.value as typeof expenseType)} className="rounded-md border border-nile-100 px-3 py-2">
              <option value="one_time">مصروف عادي</option>
              <option value="recurring">مصروف متكرر</option>
            </select>
            {expenseType === "recurring" && <select value={selectedRecurringId} onChange={(event) => selectRecurringExpense(event.target.value)} className="rounded-md border border-nile-100 px-3 py-2"><option value="">اختر مصروفًا متكررًا سابقًا (اختياري)</option>{expenses.filter((expense) => expense.expenseType === "recurring").map((expense) => <option key={expense.id} value={expense.id}>{expense.name} — {Number(expense.amount).toLocaleString()} SDG</option>)}</select>}
            {expenseType !== "one_time" && <select value={recurrencePeriod} onChange={(event) => setRecurrencePeriod(event.target.value)} className="rounded-md border border-nile-100 px-3 py-2"><option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly">شهري</option><option value="yearly">سنوي</option></select>}
            <select value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)} className="rounded-md border border-nile-100 px-3 py-2">
              <option value="">طريقة الدفع</option>
              {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
            </select>
          </div>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="ملاحظات اختيارية" rows={2} className="w-full rounded-md border border-nile-100 px-3 py-2" />
          <button type="button" onClick={saveExpense} disabled={saving} className="rounded-md bg-nile-700 px-4 py-2 font-bold text-paper disabled:opacity-60">
            {saving ? "جاري الحفظ..." : "حفظ المصروف"}
          </button>
        </section>
      )}

      {message && <p className="rounded-md bg-nile-50 px-3 py-2 text-sm text-nile-800">{message}</p>}

      <section className="overflow-x-auto rounded-lg border border-nile-100 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70"><tr><th className="p-3 text-start">التاريخ</th><th className="p-3 text-start">المصروف</th><th className="p-3 text-start">التصنيف</th><th className="p-3 text-start">المبلغ</th><th className="p-3 text-start">النوع</th><th className="p-3 text-start">طريقة الدفع</th><th className="p-3 text-start">الملاحظات</th><th className="p-3 text-start">الإجراء</th></tr></thead>
          <tbody>
            {visibleExpenses.map((expense) => <tr key={expense.id} className="border-t border-nile-50"><td className="num p-3">{new Date(expense.createdAt).toLocaleDateString("ar-SD")}</td><td className="p-3">{expense.name}</td><td className="p-3">{expense.category || "-"}</td><td className="num p-3">{editingId === expense.id ? <input type="number" min={0} value={editingAmount} onChange={(event) => setEditingAmount(Number(event.target.value))} className="num w-28 rounded border border-nile-100 px-2 py-1" /> : `${Number(expense.amount).toLocaleString()} SDG`}</td><td className="p-3">{expense.expenseType === "recurring" ? `متكرر (${expense.recurrencePeriod || "شهري"})` : "عادي"}</td><td className="p-3">{paymentMethods.find((method) => method.id === expense.paymentMethodId)?.name || "-"}</td><td className="p-3 text-ink/60">{expense.description || "-"}</td><td className="p-3 space-x-2 space-x-reverse">{expense.expenseType === "recurring" && (editingId === expense.id ? <button type="button" onClick={() => updateAmount(expense)} className="text-nile-700 underline">حفظ</button> : <button type="button" onClick={() => { setEditingId(expense.id); setEditingAmount(Number(expense.amount)); }} className="text-nile-700 underline">تعديل السعر</button>)}<button type="button" onClick={() => deleteExpense(expense)} className="text-danger underline">حذف</button></td></tr>)}
            {visibleExpenses.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-ink/50">لا توجد مصروفات</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface Customer { id: string; name: string; phone: string | null; balance: string; installmentPlansCount: number }
type CustomerFilter = "all" | "installments" | "without";

export default function CustomersPage() {
  const { t } = useLang();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");

  useEffect(() => {
    api.get<Customer[]>("/api/store/customers").then(setCustomers);
  }, []);

  const visibleCustomers = customers.filter((customer) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || customer.name.toLowerCase().includes(query) || (customer.phone ?? "").toLowerCase().includes(query);
    const hasInstallments = customer.installmentPlansCount > 0;
    const matchesFilter = filter === "all" || (filter === "installments" ? hasInstallments : !hasInstallments);
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{t("customers")}</h1>
      <div className="flex flex-col gap-2 md:flex-row">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم العميل أو رقم الهاتف" className="flex-1 rounded-md border border-nile-100 bg-white px-3 py-2" />
        <div className="flex gap-2">
          {([["all", "كل العملاء"], ["installments", "لديهم أقساط"], ["without", "بدون أقساط"]] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${filter === value ? "border-nile-700 bg-nile-700 text-paper" : "border-nile-100 bg-white"}`}>{label}</button>)}
        </div>
      </div>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr>
              <th className="text-start p-3">الاسم</th>
              <th className="text-start p-3">الهاتف</th>
              <th className="text-start p-3">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {visibleCustomers.map((c) => (
              <tr key={c.id} className="border-t border-nile-50">
                <td className="p-3"><Link to={`/customers/${c.id}`} className="text-nile-700 underline">{c.name}</Link></td>
                <td className="num p-3 text-ink/60">{c.phone || "—"}</td>
                <td className="num p-3">{Number(c.balance).toLocaleString()} SDG</td>
              </tr>
            ))}
            {visibleCustomers.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-ink/50">لا توجد نتائج</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

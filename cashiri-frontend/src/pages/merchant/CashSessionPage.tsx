import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useLang } from "../../i18n";

interface CashSession {
  id: string; status: string; openingCash: string; expectedCash: string | null; actualCash: string | null; difference: string | null; openedAt: string; closedAt: string | null;
}

export default function CashSessionPage() {
  const { t } = useLang();
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [actualCash, setActualCash] = useState(0);

  function reload() {
    api.get<CashSession[]>("/api/store/cash-sessions").then(setSessions);
  }
  useEffect(reload, []);

  const openSession = sessions.find((s) => s.status === "open");

  async function close() {
    if (!openSession) return;
    await api.post(`/api/store/cash-sessions/${openSession.id}/close`, { actualCash });
    setActualCash(0);
    reload();
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-black text-nile-900">{t("closeCash")}</h1>

      {openSession && (
        <div className="bg-white border border-nile-100 rounded-lg p-4 space-y-3">
          <p className="text-sm">
            {t("cashOpen")} <span className="num">{new Date(openSession.openedAt).toLocaleString()}</span> — {t("openingBalance")}: <span className="num">{Number(openSession.openingCash).toLocaleString()} SDG</span>
          </p>
          <label className="text-sm">{t("actualCash")}
            <input type="number" min={0} value={actualCash} onChange={(e) => setActualCash(Number(e.target.value))} className="num w-full rounded-md border border-nile-100 px-3 py-2 mt-1" />
          </label>
          <button onClick={close} className="rounded-md bg-nile-700 text-paper font-bold px-6 py-2">{t("closeCash")}</button>
        </div>
      )}

      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">الفتح</th><th className="text-start p-3">الإغلاق</th><th className="text-start p-3">المتوقع</th><th className="text-start p-3">الفعلي</th><th className="text-start p-3">الفرق</th></tr>
          </thead>
          <tbody>
            {sessions.filter((s) => s.status === "closed").map((s) => (
              <tr key={s.id} className="border-t border-nile-50">
                <td className="num p-3 text-ink/60">{new Date(s.openedAt).toLocaleDateString("ar-SD")}</td>
                <td className="num p-3 text-ink/60">{s.closedAt ? new Date(s.closedAt).toLocaleTimeString("ar-SD") : "—"}</td>
                <td className="num p-3">{s.expectedCash ? Number(s.expectedCash).toLocaleString() : "—"}</td>
                <td className="num p-3">{s.actualCash ? Number(s.actualCash).toLocaleString() : "—"}</td>
                <td className={`num p-3 ${Number(s.difference) < 0 ? "text-danger" : "text-nile-700"}`}>{s.difference ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

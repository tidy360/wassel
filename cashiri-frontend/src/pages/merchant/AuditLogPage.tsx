import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface AuditEntry { id: string; action: string; entity: string | null; entityId: string | null; userId: string | null; createdAt: string }

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    api.get<{ data: AuditEntry[] }>("/api/store/audit-log?pageSize=100").then((r) => setEntries(r.data));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-nile-900">سجل التدقيق</h1>
      <div className="bg-white border border-nile-100 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-nile-50 text-ink/70">
            <tr><th className="text-start p-3">العملية</th><th className="text-start p-3">النوع</th><th className="text-start p-3">التاريخ</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-nile-50">
                <td className="p-3 font-mono text-xs" dir="ltr">{e.action}</td>
                <td className="p-3 text-ink/60">{e.entity ?? "—"}</td>
                <td className="num p-3 text-ink/60">{new Date(e.createdAt).toLocaleString("ar-SD")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

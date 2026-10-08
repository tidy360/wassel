import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Notification { id: string; type: string; message: string; isRead: boolean; createdAt: string }

export default function NotificationsBell({ admin = false }: { admin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  function reload() {
    api.get<Notification[]>(admin ? "/api/admin/support/notifications" : "/api/store/notifications").then(setNotifications);
  }

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 60_000); // light polling — good enough until a push channel exists
    return () => clearInterval(interval);
  }, []);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  async function markRead(n: Notification) {
    await api.post(`${admin ? "/api/admin/support/notifications" : "/api/store/notifications"}/${n.id}/read`);
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative text-xl px-2" aria-label="الإشعارات">
        🔔
        {unreadCount > 0 && (
          <span className="absolute -top-1 -end-1 bg-danger text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">{unreadCount}</span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 mt-2 w-72 max-h-96 overflow-y-auto bg-white border border-nile-100 rounded-lg shadow-lg z-40">
          {notifications.length === 0 && <p className="p-4 text-sm text-ink/50 text-center">لا توجد إشعارات</p>}
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => markRead(n)}
              className={`w-full text-start p-3 border-b border-nile-50 text-sm hover:bg-nile-50 ${n.isRead ? "text-ink/50" : "font-medium"}`}
            >
              {n.message}
              <div className="text-xs text-ink/40 mt-1 num">{new Date(n.createdAt).toLocaleString("ar-SD")}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

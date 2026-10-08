import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast { id: number; message: string; kind: "success" | "error" | "info" }

const ToastContext = createContext<{ push: (message: string, kind?: Toast["kind"]) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 inset-x-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm w-full rounded-md px-4 py-3 text-sm font-medium shadow-lg text-white ${
              t.kind === "success" ? "bg-nile-700" : t.kind === "error" ? "bg-danger" : "bg-ink"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

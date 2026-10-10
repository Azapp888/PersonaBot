import * as React from "react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  message: string;
  type: "info" | "success" | "error";
}

interface ToastContextValue {
  push: (message: string, type?: Toast["type"]) => void;
}

const ToastContext = createContext<ToastContextValue>({ push: () => undefined });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[100] flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-80">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-in rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur",
              t.type === "success" && "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/90 dark:text-emerald-200",
              t.type === "error" && "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/90 dark:text-red-200",
              t.type === "info" && "border-border bg-background text-foreground dark:border-slate-700 dark:bg-slate-900",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

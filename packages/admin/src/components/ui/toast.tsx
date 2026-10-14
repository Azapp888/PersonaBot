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
              "animate-in border-l-[3px] bg-panel px-4 py-3 text-[13px] leading-relaxed text-ink shadow-[4px_4px_0_0_hsl(var(--ink)/0.14)]",
              t.type === "success" && "border-location",
              t.type === "error" && "border-alert",
              t.type === "info" && "border-ink/40",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

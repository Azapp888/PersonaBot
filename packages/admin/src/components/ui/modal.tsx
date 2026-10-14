import * as React from "react";
import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" };
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/60 backdrop-blur-[2px] sm:items-start sm:overflow-y-auto sm:p-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "animate-in relative flex h-full w-full flex-col border-rule bg-panel shadow-[6px_6px_0_0_hsl(var(--ink)/0.18)] sm:my-4 sm:h-auto sm:max-h-[88vh] sm:border",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-rule p-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-4">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-medium uppercase tracking-[0.06em] text-ink">{title}</h2>
            {description && <p className="mt-1 text-[12px] leading-relaxed text-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center border border-rule text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:max-h-none">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-rule p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

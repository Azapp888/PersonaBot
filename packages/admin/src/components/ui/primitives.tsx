import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-stamp text-white hover:bg-stamp/90 active:bg-stamp focus-visible:ring-stamp/45",
  secondary:
    "bg-ink text-paper hover:bg-ink/90 focus-visible:ring-ink/40",
  outline:
    "border border-rule bg-transparent text-ink hover:bg-ink/[0.04] focus-visible:ring-ink/25",
  ghost: "text-ink hover:bg-ink/[0.06] focus-visible:ring-ink/25",
  destructive:
    "border border-alert/50 text-alert hover:bg-alert/10 focus-visible:ring-alert/40",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-10 px-4 text-sm sm:h-9",
  sm: "h-8 px-3 text-xs",
  lg: "h-11 px-6 text-sm",
  icon: "h-10 w-10 sm:h-9 sm:w-9",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded font-mono text-[13px] font-medium uppercase tracking-[0.06em] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
        "disabled:pointer-events-none disabled:opacity-45",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

const fieldBase =
  "w-full rounded border border-rule bg-field px-3 text-sm text-ink placeholder:text-muted transition-colors focus-visible:outline-none focus-visible:border-stamp focus-visible:ring-1 focus-visible:ring-stamp/40 disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, "h-10 py-1 sm:h-9", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, "min-h-[80px] py-2 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label
    className={cn("mb-1.5 block font-mono text-[11px] uppercase tracking-[0.1em] text-muted", className)}
    {...props}
  />
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, "h-10 py-1 sm:h-9", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

/** A call-sheet section: ruled panel, no nested cards. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border border-rule bg-panel", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-b border-rule px-4 py-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("font-display text-[16px] font-medium uppercase tracking-[0.06em] text-ink", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

type BadgeVariant = "default" | "success" | "warning" | "destructive" | "secondary";
const badgeVariants: Record<BadgeVariant, string> = {
  default: "border-stamp/40 text-stamp",
  success: "border-location/40 text-location",
  warning: "border-alert/50 text-alert",
  destructive: "border-alert/50 text-alert",
  secondary: "border-rule text-muted",
};

/** Status stamp — square, ruled, never a pill. */
export function Badge({
  variant = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stamp/40 disabled:opacity-50",
        checked ? "border-stamp bg-stamp" : "border-rule bg-ink/[0.08]",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-[2px] bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

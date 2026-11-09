import { cloneElement, useId, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-xl shadow-black/20 backdrop-blur", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold tracking-wide text-slate-200">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-indigo-500 text-white hover:bg-indigo-400",
        variant === "ghost" && "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-500",
        className,
      )}
    />
  );
}

const TONES = {
  slate: "bg-slate-700/60 text-slate-200",
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  red: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  amber: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  blue: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  violet: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-white/10", TONES[tone])}>{children}</span>;
}

/** Label wraps only its text and control; the hint is linked with aria-describedby. */
export function Field({ label, children, hint }: { label: string; children: ReactElement<{ "aria-describedby"?: string }>; hint?: string }) {
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1 text-sm text-slate-300">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{label}</span>
        {hint ? cloneElement(children, { "aria-describedby": hintId }) : children}
      </label>
      {hint && <span id={hintId} className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30";

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-sm text-rose-300">{children}</p>;
}

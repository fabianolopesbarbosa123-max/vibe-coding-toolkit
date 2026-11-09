"use client";

import type { ActivityEvent } from "@/lib/domain";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/labels";

const DOT: Record<ActivityEvent["level"], string> = {
  info: "bg-sky-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  error: "bg-rose-500",
};

export function ActivityFeed({ events, limit = 12 }: { events: ActivityEvent[]; limit?: number }) {
  const items = [...events].reverse().slice(0, limit);
  if (!items.length) return <p className="text-sm text-slate-500">Nenhuma atividade registrada.</p>;
  return (
    <ol className="space-y-2" aria-live="polite">
      {items.map(event => (
        <li key={event.id} className="flex gap-2 text-sm">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[event.level])} aria-hidden />
          <div className="min-w-0">
            <p className={cn("break-words", event.level === "error" ? "text-rose-200" : "text-slate-300")}>{event.message}</p>
            <time className="text-xs text-slate-500" dateTime={event.at}>{formatDate(event.at)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}

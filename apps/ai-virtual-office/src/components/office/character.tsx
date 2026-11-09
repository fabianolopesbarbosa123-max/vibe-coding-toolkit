"use client";

import type { Agent } from "@/lib/domain";
import { cn } from "@/lib/cn";
import { ACTIVITY_LABELS, STATUS_LABELS } from "@/lib/labels";
import type { Point } from "./geometry";

const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#d1a17a"];
const HAIR = ["#2b1b10", "#5b3a1e", "#111827", "#a0522d", "#e5c07b", "#3f3f46"];

function hash(value: string) {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

const INDICATOR: Record<Agent["status"], string> = {
  idle: "bg-slate-400",
  working: "bg-sky-400 animate-pulse",
  meeting: "bg-violet-400",
  done: "bg-emerald-400",
  error: "bg-rose-500",
};

interface Props {
  agent: Agent;
  point: Point;
  seated: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function Character({ agent, point, seated, selected, onSelect }: Props) {
  const seed = hash(agent.id);
  const skin = SKIN[seed % SKIN.length];
  const hair = HAIR[(seed >> 3) % HAIR.length];
  const working = agent.status === "working";
  const bubble =
    agent.status === "working" ? `${ACTIVITY_LABELS[agent.role]}…` : agent.status === "error" ? "Erro!" : agent.status === "done" ? "Pronto ✓" : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      aria-pressed={selected}
      aria-label={`${agent.name}, ${agent.title}: ${STATUS_LABELS[agent.status]}`}
      className="group absolute z-20 -translate-x-1/2 -translate-y-full transition-[left,top] duration-[1400ms] ease-in-out focus-visible:outline-none motion-reduce:transition-none"
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
    >
      {bubble && (
        <span
          className={cn(
            "pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold shadow",
            agent.status === "error" ? "bg-rose-500 text-white" : agent.status === "done" ? "bg-emerald-500 text-emerald-950" : "bg-white text-slate-900",
          )}
        >
          {bubble}
        </span>
      )}
      <span className={cn("absolute -top-1 right-0 z-10 size-2.5 rounded-full ring-2 ring-slate-950", INDICATOR[agent.status])} />
      <svg
        viewBox="0 0 12 16"
        width="30"
        height="40"
        shapeRendering="crispEdges"
        aria-hidden
        className={cn(
          "drop-shadow-[0_3px_2px_rgba(0,0,0,0.5)] transition group-hover:scale-110 group-focus-visible:scale-110",
          working ? "animate-[typing_0.45s_steps(2)_infinite]" : "animate-[breathe_3s_ease-in-out_infinite]",
          selected && "scale-110",
          "motion-reduce:animate-none",
        )}
      >
        <rect x="3" y="0" width="6" height="2" fill={hair} />
        <rect x="2" y="1" width="8" height="2" fill={hair} />
        <rect x="3" y="3" width="6" height="4" fill={skin} />
        <rect x="2" y="3" width="1" height="2" fill={hair} />
        <rect x="9" y="3" width="1" height="2" fill={hair} />
        <rect x="4" y="4" width="1" height="1" fill="#111827" />
        <rect x="7" y="4" width="1" height="1" fill="#111827" />
        <rect x="2" y="7" width="8" height="5" fill={agent.color} />
        <rect x="1" y="8" width="1" height="3" fill={skin} />
        <rect x="10" y="8" width="1" height="3" fill={skin} />
        <rect x="5" y="7" width="2" height="1" fill="#ffffff" opacity="0.6" />
        {seated ? (
          <rect x="2" y="12" width="8" height="2" fill="#1f2937" />
        ) : (
          <>
            <rect x="3" y="12" width="2" height="4" fill="#1f2937" />
            <rect x="7" y="12" width="2" height="4" fill="#1f2937" />
          </>
        )}
      </svg>
      <span
        className={cn(
          "mt-0.5 block whitespace-nowrap rounded px-1 text-center text-[10px] font-medium",
          selected ? "bg-indigo-500 text-white" : "bg-slate-950/70 text-slate-200",
        )}
      >
        {agent.name}
      </span>
    </button>
  );
}

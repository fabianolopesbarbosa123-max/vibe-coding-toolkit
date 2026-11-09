"use client";

import type { Agent, RoomId } from "@/lib/domain";
import { ROOM_IDS } from "@/lib/domain";
import type { OfficeStats } from "@/lib/stats";
import { cn } from "@/lib/cn";
import { ROOM_LABELS } from "@/lib/labels";
import { Character } from "./character";
import { agentPosition, assignDesks, deskPosition, meetingSeat, ROOMS } from "./geometry";

const FLOORS: Record<RoomId, string> = {
  planning: "from-amber-900/40 to-amber-950/40",
  programming: "from-sky-900/40 to-slate-900/60",
  research: "from-violet-900/40 to-slate-900/60",
  marketing: "from-emerald-900/40 to-slate-900/60",
  meeting: "from-indigo-900/40 to-slate-900/60",
  support: "from-rose-900/30 to-slate-900/60",
  monitoring: "from-teal-900/40 to-slate-900/60",
};

const MIN_DESKS: Partial<Record<RoomId, number>> = { planning: 1, programming: 4, research: 2, marketing: 2, support: 2, monitoring: 1 };

interface Props {
  agents: Agent[];
  stats: OfficeStats;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function OfficeMap({ agents, stats, selectedId, onSelect }: Props) {
  const desks = assignDesks(agents);
  const meetingOrder = agents.filter(agent => agent.status === "meeting").map(agent => agent.id);
  const deskCount = new Map<RoomId, number>();
  for (const agent of agents) deskCount.set(agent.room, (deskCount.get(agent.room) ?? 0) + 1);
  const workingDesks = new Set(agents.filter(agent => agent.status === "working").map(agent => `${agent.room}:${desks.get(agent.id)}`));

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950 shadow-2xl">
      <div
        role="group"
        aria-label="Escritório virtual"
        className="relative aspect-[5/3] min-w-[680px] bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)] bg-[length:16px_16px]"
      >
        <div className="absolute inset-x-0 top-[45%] h-[10%] bg-slate-800/40" aria-hidden>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.3em] text-slate-500">Corredor</span>
        </div>

        {ROOM_IDS.map(room => {
          const rect = ROOMS[room];
          const total = room === "meeting" ? 0 : Math.max(deskCount.get(room) ?? 0, MIN_DESKS[room] ?? 0);
          return (
            <div
              key={room}
              className={cn("absolute rounded-xl border border-white/10 bg-gradient-to-br", FLOORS[room])}
              style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
            >
              <span className="absolute left-2 top-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300/80">{ROOM_LABELS[room]}</span>
              {room === "monitoring" && <MonitoringWall stats={stats} />}
              {Array.from({ length: total }, (_, index) => {
                const desk = deskPosition(room, index);
                const lit = workingDesks.has(`${room}:${index}`);
                return (
                  <div
                    key={index}
                    aria-hidden
                    className="absolute h-[14%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-md border border-amber-950/60 bg-amber-800/80 shadow-md"
                    style={{ left: `${((desk.x - rect.x) / rect.w) * 100}%`, top: `${((desk.y - rect.y) / rect.h) * 100}%` }}
                  >
                    <div
                      className={cn(
                        "absolute left-1/2 top-[12%] h-[55%] w-[44%] -translate-x-1/2 rounded-sm border border-slate-900",
                        lit ? "animate-[screen_1.2s_ease-in-out_infinite] bg-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.8)] motion-reduce:animate-none" : "bg-slate-700",
                      )}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}

        <MeetingTable />
        <Plant x={28} y={6} />
        <Plant x={98} y={52} />
        <Plant x={2} y={52} />

        {agents.map(agent => {
          const { point, seated } = agentPosition(agent, desks.get(agent.id) ?? 0, Math.max(0, meetingOrder.indexOf(agent.id)));
          return <Character key={agent.id} agent={agent} point={point} seated={seated} selected={agent.id === selectedId} onSelect={onSelect} />;
        })}
      </div>
    </div>
  );
}

function MeetingTable() {
  const rect = ROOMS.meeting;
  const chairs = Array.from({ length: 8 }, (_, index) => meetingSeat(index));
  return (
    <div aria-hidden>
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-amber-950/60 bg-amber-700/80 shadow-lg"
        style={{ left: `${rect.x + rect.w / 2}%`, top: `${rect.y + rect.h / 2 + 5}%`, width: `${rect.w * 0.5}%`, height: `${rect.h * 0.34}%` }}
      />
      {chairs.map((chair, index) => (
        <div
          key={index}
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-slate-600"
          style={{ left: `${chair.x}%`, top: `${chair.y}%` }}
        />
      ))}
    </div>
  );
}

function MonitoringWall({ stats }: { stats: OfficeStats }) {
  const items = [
    { label: "Ativos", value: stats.activeAgents },
    { label: "Rodando", value: stats.tasksRunning },
    { label: "Feitas", value: stats.tasksCompleted },
    { label: "Erros", value: stats.errors },
  ];
  return (
    <div className="absolute bottom-[6%] right-[4%] grid w-[52%] grid-cols-2 gap-1 rounded-md border border-teal-500/40 bg-slate-950/80 p-1 shadow-[0_0_16px_rgba(45,212,191,0.25)]">
      {items.map(item => (
        <div key={item.label} className="rounded bg-teal-950/70 px-1 py-0.5 text-center">
          <div className="font-mono text-xs font-bold text-teal-300">{item.value}</div>
          <div className="text-[8px] uppercase text-teal-500">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <div aria-hidden className="absolute size-4 -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
      <div className="absolute inset-0 rounded-full bg-emerald-600 shadow-[inset_-2px_-2px_0_rgba(0,0,0,0.3)]" />
      <div className="absolute inset-[30%] rounded-full bg-emerald-400" />
    </div>
  );
}

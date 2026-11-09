"use client";

import { useState } from "react";
import type { Agent } from "@/lib/domain";
import { Badge, Button, Card } from "@/components/ui";
import { PROVIDER_LABELS, ROOM_LABELS, STATUS_LABELS } from "@/lib/labels";
import { AGENT_STATUS_TONE } from "@/lib/tones";
import { AgentForm } from "./agent-form";

export function AgentList({ agents }: { agents: Agent[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {agents.map(agent => (
        <Card
          key={agent.id}
          title={
            <span className="flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: agent.color }} aria-hidden />
              {agent.name} — {agent.title}
            </span>
          }
          action={<Badge tone={AGENT_STATUS_TONE[agent.status]}>{STATUS_LABELS[agent.status]}</Badge>}
        >
          {editing === agent.id ? (
            <AgentForm key={agent.id} agent={agent} onDone={() => setEditing(null)} />
          ) : (
            <>
              <p className="text-xs text-slate-500">{ROOM_LABELS[agent.room]} · {PROVIDER_LABELS[agent.provider]}{agent.model ? ` · ${agent.model}` : ""}</p>
              <p className="mt-2 line-clamp-4 text-sm text-slate-400">{agent.instructions}</p>
              <Button variant="ghost" className="mt-3 px-2 py-1 text-xs" onClick={() => setEditing(agent.id)} disabled={agent.status === "working"}>Editar</Button>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}

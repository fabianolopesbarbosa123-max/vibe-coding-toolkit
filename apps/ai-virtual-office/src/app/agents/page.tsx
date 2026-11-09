"use client";

import { AgentForm } from "@/components/agents/agent-form";
import { AgentList } from "@/components/agents/agent-list";
import { WithSnapshot } from "@/components/page-state";
import { Card } from "@/components/ui";

export default function AgentsPage() {
  return (
    <WithSnapshot>
      {snapshot => (
        <div className="grid gap-4">
          <h1 className="text-xl font-semibold text-slate-100">Agentes</h1>
          <AgentList agents={snapshot.agents} />
          <Card title="Cadastrar novo agente"><AgentForm /></Card>
        </div>
      )}
    </WithSnapshot>
  );
}

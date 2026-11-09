"use client";

import { useState } from "react";
import { ActivityFeed } from "@/components/activity-feed";
import { AgentPanel } from "@/components/office/agent-panel";
import { CeoRequest } from "@/components/office/ceo-request";
import { OfficeMap } from "@/components/office/office-map";
import { WithSnapshot } from "@/components/page-state";
import { ProjectList } from "@/components/tasks/project-list";
import { Card } from "@/components/ui";

export default function OfficePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <WithSnapshot>
      {snapshot => (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="grid min-w-0 gap-4">
            <OfficeMap reducedMotion={snapshot.settings.reducedMotion} agents={snapshot.agents} stats={snapshot.stats} selectedId={selectedId} onSelect={setSelectedId} />
            <CeoRequest />
            <Card title="Projetos recentes"><ProjectList projects={snapshot.projects} tasks={snapshot.tasks} limit={4} /></Card>
          </div>
          <aside className="grid content-start gap-4">
            <AgentPanel agent={snapshot.agents.find(agent => agent.id === selectedId)} tasks={snapshot.tasks} />
            <Card title="Atividade ao vivo"><ActivityFeed events={snapshot.events} /></Card>
          </aside>
        </div>
      )}
    </WithSnapshot>
  );
}

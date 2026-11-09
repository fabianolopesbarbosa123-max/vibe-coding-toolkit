"use client";

import type { Integration } from "@/lib/domain";
import { Badge } from "@/components/ui";
import { INTEGRATION_TONE } from "@/lib/tones";

const LABEL = { available: "Disponível", unavailable: "Indisponível", planned: "Planejada" } as const;

export function IntegrationList({ integrations }: { integrations: Integration[] }) {
  return (
    <ul className="space-y-2">
      {integrations.map(item => (
        <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium text-slate-200">{item.label}</p>
            <p className="text-xs text-slate-500">{item.detail}</p>
          </div>
          <Badge tone={INTEGRATION_TONE[item.status]}>{LABEL[item.status]}</Badge>
        </li>
      ))}
    </ul>
  );
}

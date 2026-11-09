"use client";

import { Dashboard } from "@/components/dashboard/dashboard";
import { WithSnapshot } from "@/components/page-state";

export default function DashboardPage() {
  return (
    <WithSnapshot>
      {snapshot => (
        <div className="grid gap-4">
          <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
          <Dashboard snapshot={snapshot} />
        </div>
      )}
    </WithSnapshot>
  );
}

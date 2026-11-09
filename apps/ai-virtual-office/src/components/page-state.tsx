"use client";

import type { ReactNode } from "react";
import type { OfficeSnapshot } from "@/lib/api-types";
import { useOffice } from "@/components/office-provider";

/** Renders children once the first snapshot loads; shows load errors instead of fake data. */
export function WithSnapshot({ children }: { children: (snapshot: OfficeSnapshot) => ReactNode }) {
  const { snapshot, loadError } = useOffice();
  if (loadError && !snapshot) return <p role="alert" className="rounded-xl bg-rose-500/10 p-4 text-rose-200">{loadError}</p>;
  if (!snapshot) return <p className="animate-pulse text-slate-400">Carregando o escritório…</p>;
  return children(snapshot);
}

"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { OfficeSnapshot } from "@/lib/api-types";

interface OfficeContextValue {
  snapshot: OfficeSnapshot | null;
  loadError: string | null;
  refresh: () => Promise<void>;
  post: <T = unknown>(url: string, body?: unknown, method?: "POST" | "PATCH") => Promise<T>;
}

const OfficeContext = createContext<OfficeContextValue | null>(null);

const BUSY_INTERVAL = 1500;
const IDLE_INTERVAL = 5000;

export function OfficeProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar o escritório.");
      const next = data as OfficeSnapshot;
      busy.current =
        next.stats.tasksRunning > 0 ||
        next.projects.some(project => project.status === "planning" || project.status === "running");
      setSnapshot(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Falha ao carregar o escritório.");
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, busy.current ? BUSY_INTERVAL : IDLE_INTERVAL);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  const post = useCallback(
    async <T,>(url: string, body: unknown = {}, method: "POST" | "PATCH" = "POST") => {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Erro ${response.status}`);
      busy.current = true;
      await refresh();
      return data as T;
    },
    [refresh],
  );

  return <OfficeContext value={{ snapshot, loadError, refresh, post }}>{children}</OfficeContext>;
}

export function useOffice() {
  const value = useContext(OfficeContext);
  if (!value) throw new Error("useOffice must be used inside OfficeProvider");
  return value;
}

"use client";

import { hardNavigate } from "@/lib/hard-navigate";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { OfficeSnapshot } from "@/lib/api-types";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type SyncStatus = "connecting" | "live" | "polling" | "offline";
export type ToastTone = "success" | "error" | "info";
export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface OfficeContextValue {
  snapshot: OfficeSnapshot | null;
  loadError: string | null;
  sync: SyncStatus;
  toasts: Toast[];
  refresh: () => Promise<void>;
  post: <T = unknown>(url: string, body?: unknown, method?: "POST" | "PATCH") => Promise<T>;
  notify: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

const OfficeContext = createContext<OfficeContextValue | null>(null);

/** Realtime tables that change what the office shows. RLS limits events to the owner's rows. */
const REALTIME_TABLES = ["agents", "projects", "tasks", "activity_events", "usage_records", "files"] as const;
const POLL_BUSY = 1500;
const POLL_IDLE = 5000;
const REALTIME_DEBOUNCE = 250;

export function OfficeProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>("connecting");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busy = useRef(false);
  const toastId = useRef(0);

  const notify = useCallback((message: string, tone: ToastTone = "success") => {
    const id = ++toastId.current;
    setToasts(current => [...current.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 4500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (response.status === 401) {
        hardNavigate(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar o escritório.");
      const next = data as OfficeSnapshot;
      busy.current = next.stats.tasksRunning > 0 || next.projects.some(project => project.status === "planning" || project.status === "running");
      setSnapshot(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof TypeError ? "Sem conexão com o servidor." : error instanceof Error ? error.message : "Falha ao carregar o escritório.");
    }
  }, []);

  // Realtime when Supabase is configured; polling only as a fallback or in local mode.
  useEffect(() => {
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let live = false;

    const poll = async () => {
      if (stopped || live) return;
      await refresh();
      if (!stopped && !live) pollTimer = setTimeout(poll, busy.current ? POLL_BUSY : POLL_IDLE);
    };
    const startPolling = () => {
      live = false;
      clearTimeout(pollTimer);
      if (!stopped) setSync(navigator.onLine ? "polling" : "offline");
      poll();
    };
    const scheduleRefresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, REALTIME_DEBOUNCE);
    };

    const initial = setTimeout(refresh, 0);
    if (!isSupabaseConfigured) {
      startPolling();
      return () => {
        stopped = true;
        clearTimeout(initial);
        clearTimeout(pollTimer);
      };
    }

    const supabase = getBrowserSupabase();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (stopped) return;
      if (!userId) {
        startPolling();
        return;
      }
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel = supabase.channel(`office:${userId}`);
      for (const table of REALTIME_TABLES) {
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `owner_id=eq.${userId}` }, scheduleRefresh);
      }
      channel.subscribe(status => {
        if (stopped) return;
        if (status === "SUBSCRIBED") {
          live = true;
          clearTimeout(pollTimer);
          setSync("live");
          refresh(); // catch up on anything missed while connecting
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          startPolling();
        }
      });
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") hardNavigate("/login");
    });
    const onOnline = () => {
      setSync(live ? "live" : "polling");
      refresh();
    };
    const onOffline = () => setSync("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      stopped = true;
      clearTimeout(initial);
      clearTimeout(pollTimer);
      clearTimeout(debounce);
      if (channel) supabase.removeChannel(channel);
      authListener.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  const post = useCallback(
    async <T,>(url: string, body: unknown = {}, method: "POST" | "PATCH" = "POST") => {
      let response: Response;
      try {
        response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } catch {
        throw new Error("Sem conexão com o servidor. Tente novamente.");
      }
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) hardNavigate(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      if (!response.ok) throw new Error(data.error ?? `Erro ${response.status}`);
      busy.current = true;
      await refresh();
      return data as T;
    },
    [refresh],
  );

  return (
    <OfficeContext value={{ snapshot, loadError, sync, toasts, refresh, post, notify, dismiss }}>{children}</OfficeContext>
  );
}

export function useOffice() {
  const value = useContext(OfficeContext);
  if (!value) throw new Error("useOffice must be used inside OfficeProvider");
  return value;
}

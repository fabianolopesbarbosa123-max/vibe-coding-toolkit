"use client";

import { useState } from "react";
import { useOffice } from "@/components/office-provider";
import { Button } from "@/components/ui";

/** Starts a run and shows the server's reason when it refuses (busy agent, missing integration). */
export function RunButton({ url, label, disabled }: { url: string; label: string; disabled?: boolean }) {
  const { post } = useOffice();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        className="px-2 py-1 text-xs"
        disabled={disabled || pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await post(url);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Falha ao iniciar.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Iniciando…" : label}
      </Button>
      {error && <span role="alert" className="max-w-56 text-right text-xs text-rose-300">{error}</span>}
    </span>
  );
}

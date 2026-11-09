"use client";

import { useState, type FormEvent } from "react";
import { useOffice } from "@/components/office-provider";
import { Button, Card, ErrorText, inputClass } from "@/components/ui";

export function CeoRequest() {
  const { snapshot, post } = useOffice();
  const [request, setRequest] = useState("");
  const [autoRun, setAutoRun] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ceo = snapshot?.agents.find(agent => agent.role === "ceo");
  const claude = snapshot?.integrations.find(item => item.id === (ceo?.provider === "openai" ? "openai-api" : "claude-api"));
  const unavailable = claude?.status !== "available";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await post("/api/orchestrate", { request, autoRun });
      setRequest("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title={`Pedir ao CEO${ceo ? ` (${ceo.name})` : ""}`}>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="ceo-request" className="sr-only">Solicitação para o CEO</label>
        <textarea
          id="ceo-request"
          required
          maxLength={4000}
          rows={3}
          value={request}
          onChange={event => setRequest(event.target.value)}
          placeholder="Ex.: Crie um aplicativo de gestão financeira"
          className={inputClass}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={autoRun} onChange={event => setAutoRun(event.target.checked)} className="accent-indigo-500" />
            Executar automaticamente após o planejamento
          </label>
          <Button type="submit" disabled={pending || unavailable || !request.trim()}>
            {pending ? "Enviando…" : "Enviar ao CEO"}
          </Button>
        </div>
        {unavailable && claude && <p className="text-xs text-amber-300">Integração indisponível: {claude.detail}</p>}
        <ErrorText>{error}</ErrorText>
      </form>
    </Card>
  );
}

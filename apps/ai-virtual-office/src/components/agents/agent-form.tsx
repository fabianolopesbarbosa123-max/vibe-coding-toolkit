"use client";

import { useState, type FormEvent } from "react";
import { useOffice } from "@/components/office-provider";
import { Button, ErrorText, Field, inputClass } from "@/components/ui";
import { AGENT_ROLES, PROVIDERS, ROOM_IDS, type Agent, type AgentInput } from "@/lib/domain";
import { PROVIDER_LABELS, ROLE_LABELS, ROOM_LABELS } from "@/lib/labels";

const EMPTY: AgentInput = {
  name: "",
  role: "custom",
  title: "",
  room: "support",
  color: "#6366f1",
  provider: "anthropic",
  model: null,
  instructions: "",
};

export function AgentForm({ agent, onDone }: { agent?: Agent; onDone?: () => void }) {
  const { post } = useOffice();
  const [form, setForm] = useState<AgentInput>(agent ? { ...agent } : EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AgentInput>(key: K) => (event: { target: { value: string } }) =>
    setForm(current => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const body = {
      name: form.name,
      role: form.role,
      title: form.title,
      room: form.room,
      color: form.color,
      provider: form.provider,
      model: form.model ?? "",
      instructions: form.instructions,
    };
    try {
      if (agent) await post(`/api/agents/${agent.id}`, body, "PATCH");
      else {
        await post("/api/agents", body);
        setForm(EMPTY);
      }
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><input required maxLength={40} value={form.name} onChange={set("name")} className={inputClass} /></Field>
        <Field label="Cargo exibido"><input required maxLength={60} value={form.title} onChange={set("title")} className={inputClass} /></Field>
        <Field label="Função">
          <select value={form.role} onChange={set("role")} className={inputClass}>
            {AGENT_ROLES.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
        </Field>
        <Field label="Sala">
          <select value={form.room} onChange={set("room")} className={inputClass}>
            {ROOM_IDS.filter(room => room !== "meeting").map(room => <option key={room} value={room}>{ROOM_LABELS[room]}</option>)}
          </select>
        </Field>
        <Field label="Integração de IA">
          <select value={form.provider} onChange={set("provider")} className={inputClass}>
            {PROVIDERS.map(provider => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
          </select>
        </Field>
        <Field label="Modelo (opcional)" hint="Vazio usa o modelo padrão do .env.local.">
          <input maxLength={80} value={form.model ?? ""} onChange={set("model")} className={inputClass} placeholder="padrão" />
        </Field>
      </div>
      <Field label="Cor"><input type="color" value={form.color} onChange={set("color")} className="h-9 w-16 rounded border border-white/10 bg-transparent" /></Field>
      <Field label="Instruções do agente">
        <textarea required maxLength={4000} rows={4} value={form.instructions} onChange={set("instructions")} className={inputClass} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Salvando…" : agent ? "Salvar" : "Cadastrar agente"}</Button>
        {onDone && agent && <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>}
      </div>
    </form>
  );
}

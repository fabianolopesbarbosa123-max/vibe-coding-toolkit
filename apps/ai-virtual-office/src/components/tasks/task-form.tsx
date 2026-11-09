"use client";

import { useState, type FormEvent } from "react";
import { useOffice } from "@/components/office-provider";
import { Button, Card, ErrorText, Field, inputClass } from "@/components/ui";
import { PRIORITIES, type Priority } from "@/lib/domain";
import { PRIORITY_LABELS } from "@/lib/labels";

export function TaskForm() {
  const { snapshot, post } = useOffice();
  const [form, setForm] = useState({ title: "", description: "", agentId: "", priority: "medium" as Priority, projectId: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agents = snapshot?.agents ?? [];
  const projects = (snapshot?.projects ?? []).filter(project => project.status !== "completed");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await post("/api/tasks", { ...form, projectId: form.projectId || null });
      setForm(current => ({ ...current, title: "", description: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar tarefa.");
    } finally {
      setPending(false);
    }
  }

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value }));

  return (
    <Card title="Nova tarefa">
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Nome">
          <input required maxLength={120} value={form.title} onChange={set("title")} className={inputClass} />
        </Field>
        <Field label="Descrição">
          <textarea required maxLength={4000} rows={3} value={form.description} onChange={set("description")} className={inputClass} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Agente responsável">
            <select required value={form.agentId} onChange={set("agentId")} className={inputClass}>
              <option value="">Selecione…</option>
              {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} — {agent.title}</option>)}
            </select>
          </Field>
          <Field label="Prioridade">
            <select value={form.priority} onChange={set("priority")} className={inputClass}>
              {PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Projeto (opcional)" hint="Tarefas de um projeto compartilham resultados com as seguintes.">
          <select value={form.projectId} onChange={set("projectId")} className={inputClass}>
            <option value="">Sem projeto</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending}>{pending ? "Criando…" : "Criar tarefa"}</Button>
      </form>
    </Card>
  );
}

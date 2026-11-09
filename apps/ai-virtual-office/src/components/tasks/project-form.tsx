"use client";

import { useState, type FormEvent } from "react";
import { useOffice } from "@/components/office-provider";
import { Button, Card, ErrorText, Field, inputClass } from "@/components/ui";

export function ProjectForm() {
  const { post, notify } = useOffice();
  const [name, setName] = useState("");
  const [request, setRequest] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await post("/api/projects", { name, request });
      setName("");
      setRequest("");
      notify("Projeto criado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar projeto.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title="Novo projeto manual">
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Nome">
          <input required maxLength={80} value={name} onChange={event => setName(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Objetivo" hint="Para o CEO planejar sozinho, use “Pedir ao CEO” no escritório.">
          <textarea required maxLength={4000} rows={2} value={request} onChange={event => setRequest(event.target.value)} className={inputClass} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="ghost" disabled={pending}>{pending ? "Criando…" : "Criar projeto"}</Button>
      </form>
    </Card>
  );
}

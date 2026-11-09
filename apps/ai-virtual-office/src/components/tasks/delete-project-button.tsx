"use client";

import { useState } from "react";
import { useOffice } from "@/components/office-provider";
import type { Project } from "@/lib/domain";

/** Deletes a project with its tasks, conversations, and files after explicit confirmation. */
export function DeleteProjectButton({ project, taskCount, fileCount }: { project: Project; taskCount: number; fileCount: number }) {
  const { notify, refresh } = useOffice();
  const [pending, setPending] = useState(false);
  const busy = project.status === "planning" || project.status === "running";

  async function remove() {
    const details = [`${taskCount} tarefa(s)`, "as conversas dos agentes", fileCount ? `${fileCount} arquivo(s)` : null].filter(Boolean).join(", ");
    if (!window.confirm(`Excluir o projeto "${project.name}"?\n\nSerão removidos: ${details}. O histórico de consumo é mantido. Esta ação não pode ser desfeita.`)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Erro ${response.status}`);
      notify(`Projeto "${project.name}" excluído.`);
      await refresh();
    } catch (err) {
      notify(err instanceof TypeError ? "Sem conexão com o servidor." : err instanceof Error ? err.message : "Falha ao excluir.", "error");
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy || pending}
      title={busy ? "Aguarde a execução terminar para excluir" : undefined}
      aria-label={`Excluir projeto ${project.name}`}
      className="rounded-lg px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Excluindo…" : "Excluir"}
    </button>
  );
}

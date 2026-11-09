"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useOffice } from "@/components/office-provider";
import { Button, Card, ErrorText, inputClass } from "@/components/ui";
import type { OfficeSnapshot } from "@/lib/api-types";
import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES } from "@/lib/domain";
import { formatDate } from "@/lib/labels";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const BUCKET = "office-files";
const formatSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
const safeName = (name: string) => name.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-120) || "arquivo";

/**
 * Uploads go straight from the browser to the private bucket under "<user id>/...",
 * which Storage RLS enforces; the server then validates and records the metadata.
 */
export function FileManager({ snapshot }: { snapshot: OfficeSnapshot }) {
  const { post, notify, refresh } = useOffice();
  const input = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (snapshot.mode !== "supabase") {
    return (
      <Card title="Arquivos">
        <p className="text-sm text-slate-400">O armazenamento de arquivos fica disponível com o Supabase configurado.</p>
      </Card>
    );
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(file.type)) {
      setError("Tipo não permitido. Use texto, Markdown, CSV, JSON, PDF, PNG, JPEG ou WebP.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("O arquivo excede o limite de 10 MB.");
      return;
    }
    setPending(true);
    const supabase = getBrowserSupabase();
    const id = crypto.randomUUID();
    const storagePath = `${snapshot.profile.id}/${id}/${safeName(file.name)}`;
    try {
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error("Falha no envio do arquivo.");
      try {
        await post("/api/files", { id, name: file.name.slice(0, 200), storagePath, mimeType: file.type, sizeBytes: file.size, projectId: projectId || null });
      } catch (err) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw err;
      }
      notify("Arquivo enviado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no envio do arquivo.");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Excluir "${name}"?`)) return;
    const response = await fetch(`/api/files/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      notify("Não foi possível excluir o arquivo.", "error");
      return;
    }
    notify("Arquivo excluído.");
    await refresh();
  }

  return (
    <Card title={`Arquivos (${snapshot.files.length})`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="file-project">Projeto do arquivo</label>
        <select id="file-project" value={projectId} onChange={event => setProjectId(event.target.value)} className={`${inputClass} w-auto flex-1`}>
          <option value="">Sem projeto</option>
          {snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <input ref={input} type="file" className="hidden" accept={ALLOWED_FILE_TYPES.join(",")} onChange={upload} aria-label="Selecionar arquivo" />
        <Button type="button" variant="ghost" onClick={() => input.current?.click()} disabled={pending}>
          {pending ? "Enviando…" : "Enviar arquivo"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Até 10 MB. Arquivos privados, acessíveis só por você.</p>
      <ErrorText>{error}</ErrorText>
      <ul className="mt-3 space-y-2">
        {snapshot.files.map(file => (
          <li key={file.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/50 px-3 py-2 text-sm">
            <div className="min-w-0">
              <a href={`/api/files/${file.id}`} className="block truncate text-slate-200 hover:underline">{file.name}</a>
              <span className="text-xs text-slate-500">
                {formatSize(file.sizeBytes)} · {formatDate(file.createdAt)}
                {file.projectId && ` · ${snapshot.projects.find(project => project.id === file.projectId)?.name ?? ""}`}
              </span>
            </div>
            <button type="button" onClick={() => remove(file.id, file.name)} className="shrink-0 rounded px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10">Excluir</button>
          </li>
        ))}
        {!snapshot.files.length && <li className="text-sm text-slate-500">Nenhum arquivo enviado.</li>}
      </ul>
    </Card>
  );
}

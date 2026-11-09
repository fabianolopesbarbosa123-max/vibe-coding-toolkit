import "server-only";
import type { z } from "zod";
import type { OfficeFile, Profile, profilePatchSchema, UserSettings, fileInputSchema } from "@/lib/domain";
import { HttpError } from "./http";
import type { OfficeContext } from "./store";
import { mapKeys } from "./store/supabase-store";

export const FILES_BUCKET = "office-files";

const LOCAL_SETTINGS: UserSettings = { autoRun: true, reducedMotion: false, defaultProvider: "anthropic", budgetAlertPercent: 80, personalMonthlyBudgetUsd: null };
const camel = (key: string) => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());

function requireSupabase(ctx: OfficeContext) {
  if (!ctx.supabase) throw new HttpError(409, "Disponível apenas com o Supabase configurado.");
  return ctx.supabase;
}

export async function getAccount(ctx: OfficeContext): Promise<{ profile: Profile; settings: UserSettings }> {
  if (!ctx.supabase) return { profile: { id: ctx.userId, email: null, fullName: "Modo local" }, settings: LOCAL_SETTINGS };
  const [profile, settings] = await Promise.all([
    ctx.supabase.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
    ctx.supabase.from("user_settings").select("auto_run, reduced_motion, default_provider, budget_alert_percent, personal_monthly_budget_usd").eq("user_id", ctx.userId).maybeSingle(),
  ]);
  if (profile.error || settings.error) throw new Error("Supabase account read failed");
  return {
    profile: { id: ctx.userId, email: ctx.email, fullName: profile.data?.full_name ?? "" },
    settings: settings.data
      ? {
          ...mapKeys<UserSettings>(settings.data, camel),
          personalMonthlyBudgetUsd: settings.data.personal_monthly_budget_usd === null ? null : Number(settings.data.personal_monthly_budget_usd),
        }
      : LOCAL_SETTINGS,
  };
}

export async function updateAccount(ctx: OfficeContext, patch: z.infer<typeof profilePatchSchema>) {
  const supabase = requireSupabase(ctx);
  if (patch.fullName !== undefined) {
    const { error } = await supabase.from("profiles").update({ full_name: patch.fullName }).eq("id", ctx.userId);
    if (error) throw new Error("Supabase profile update failed");
  }
  if (patch.settings && Object.keys(patch.settings).length) {
    const { autoRun, reducedMotion, defaultProvider, budgetAlertPercent, personalMonthlyBudgetUsd } = patch.settings;
    const row = Object.fromEntries(
      Object.entries({
        auto_run: autoRun,
        reduced_motion: reducedMotion,
        default_provider: defaultProvider,
        budget_alert_percent: budgetAlertPercent,
        personal_monthly_budget_usd: personalMonthlyBudgetUsd,
      }).filter(([, value]) => value !== undefined),
    );
    const { error } = await supabase.from("user_settings").update(row).eq("user_id", ctx.userId);
    if (error) throw new Error("Supabase settings update failed");
  }
  return getAccount(ctx);
}

export async function listFiles(ctx: OfficeContext): Promise<OfficeFile[]> {
  if (!ctx.supabase) return [];
  const { data, error } = await ctx.supabase
    .from("files")
    .select("id, project_id, name, storage_path, mime_type, size_bytes, created_at")
    .eq("owner_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error("Supabase files read failed");
  return (data ?? []).map(row => ({ ...mapKeys<OfficeFile>(row, camel), sizeBytes: Number(row.size_bytes) }));
}

/** Registers an object the browser already uploaded under "<user id>/<file id>/<name>". */
export async function registerFile(ctx: OfficeContext, input: z.infer<typeof fileInputSchema>) {
  const supabase = requireSupabase(ctx);
  if (!input.storagePath.startsWith(`${ctx.userId}/${input.id}/`)) throw new HttpError(422, "Caminho de arquivo inválido.");
  const { error } = await supabase.from("files").insert({
    id: input.id,
    owner_id: ctx.userId,
    project_id: input.projectId,
    name: input.name,
    storage_path: input.storagePath,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
  });
  if (error) throw new HttpError(422, "Não foi possível registrar o arquivo.");
}

async function findFile(ctx: OfficeContext, fileId: string) {
  // Ownership is checked here and again by RLS and Storage policies.
  const supabase = requireSupabase(ctx);
  const { data, error } = await supabase.from("files").select("storage_path, name").eq("id", fileId).eq("owner_id", ctx.userId).maybeSingle();
  if (error || !data) throw new HttpError(404, "Arquivo não encontrado.");
  return { supabase, path: data.storage_path as string, name: data.name as string };
}

export async function fileDownloadUrl(ctx: OfficeContext, fileId: string): Promise<string> {
  const { supabase, path, name } = await findFile(ctx, fileId);
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(path, 60, { download: name });
  if (error || !data) throw new HttpError(404, "Arquivo indisponível no armazenamento.");
  return data.signedUrl;
}

/** Removes Storage objects that belong to the caller. Throws if Storage reports an error. */
async function removeObjects(ctx: OfficeContext, paths: string[]) {
  const supabase = requireSupabase(ctx);
  const prefix = `${ctx.userId}/`;
  if (paths.some(path => !path.startsWith(prefix))) throw new HttpError(403, "Arquivo pertence a outro usuário.");
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage.from(FILES_BUCKET).remove(paths.slice(index, index + 100));
    if (error) throw new HttpError(502, "Falha ao remover arquivos do armazenamento. Nada foi excluído; tente novamente.");
  }
}

/**
 * Deletes metadata rows. The database only allows it once the object is gone, so a
 * shorter result means some objects are still in Storage and the caller must stop.
 */
async function deleteFileRows(ctx: OfficeContext, ids: string[]) {
  if (!ids.length) return;
  const supabase = requireSupabase(ctx);
  const { data, error } = await supabase.from("files").delete().in("id", ids).eq("owner_id", ctx.userId).select("id");
  if (error) throw new Error("Supabase file delete failed");
  if ((data ?? []).length !== ids.length) throw new HttpError(502, "Alguns arquivos ainda estão no armazenamento. Tente novamente.");
}

export async function deleteFile(ctx: OfficeContext, fileId: string) {
  const { path } = await findFile(ctx, fileId);
  await removeObjects(ctx, [path]);
  await deleteFileRows(ctx, [fileId]);
}

/**
 * Deletes a project with its files, tasks, and conversations. Order: Storage objects,
 * then file rows, then the project (cascading tasks and conversations). Each step is
 * safe to retry, and the database refuses to drop a project that still has files.
 */
export async function deleteProject(ctx: OfficeContext, projectId: string): Promise<{ name: string; files: number }> {
  const state = await ctx.store.snapshot();
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new HttpError(404, "Projeto não encontrado.");
  if (project.status === "planning" || project.status === "running") {
    throw new HttpError(409, "O projeto está em execução. Aguarde terminar para excluir.");
  }
  let files: { id: string; storage_path: string }[] = [];
  if (ctx.supabase) {
    // Checked before touching Storage: the database also refuses, but only after files were removed.
    const jobs = await ctx.supabase
      .from("jobs")
      .select("id, task_id, project_id")
      .eq("owner_id", ctx.userId)
      .in("status", ["pending", "queued", "running", "waiting_approval"]);
    if (jobs.error) throw new Error("Supabase jobs read failed");
    const taskIds = new Set(state.tasks.filter(task => task.projectId === projectId).map(task => task.id));
    if ((jobs.data ?? []).some(job => job.project_id === projectId || (job.task_id && taskIds.has(job.task_id)))) {
      throw new HttpError(409, "O projeto tem execuções na fila ou em andamento. Cancele-as ou aguarde para excluir.");
    }
    const { data, error } = await ctx.supabase.from("files").select("id, storage_path").eq("project_id", projectId).eq("owner_id", ctx.userId);
    if (error) throw new Error("Supabase files read failed");
    files = data ?? [];
    await removeObjects(ctx, files.map(file => file.storage_path));
    await deleteFileRows(ctx, files.map(file => file.id));
  }
  if (!(await ctx.store.deleteProject(projectId))) throw new HttpError(409, "O projeto mudou de estado. Atualize e tente novamente.");
  return { name: project.name, files: files.length };
}

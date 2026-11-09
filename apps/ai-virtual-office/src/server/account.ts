import "server-only";
import type { z } from "zod";
import type { OfficeFile, Profile, profilePatchSchema, UserSettings, fileInputSchema } from "@/lib/domain";
import { HttpError } from "./http";
import type { OfficeContext } from "./store";
import { mapKeys } from "./store/supabase-store";

export const FILES_BUCKET = "office-files";

const LOCAL_SETTINGS: UserSettings = { autoRun: true, reducedMotion: false, defaultProvider: "anthropic" };
const camel = (key: string) => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());

function requireSupabase(ctx: OfficeContext) {
  if (!ctx.supabase) throw new HttpError(409, "Disponível apenas com o Supabase configurado.");
  return ctx.supabase;
}

export async function getAccount(ctx: OfficeContext): Promise<{ profile: Profile; settings: UserSettings }> {
  if (!ctx.supabase) return { profile: { id: ctx.userId, email: null, fullName: "Modo local" }, settings: LOCAL_SETTINGS };
  const [profile, settings] = await Promise.all([
    ctx.supabase.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
    ctx.supabase.from("user_settings").select("auto_run, reduced_motion, default_provider").eq("user_id", ctx.userId).maybeSingle(),
  ]);
  if (profile.error || settings.error) throw new Error("Supabase account read failed");
  return {
    profile: { id: ctx.userId, email: ctx.email, fullName: profile.data?.full_name ?? "" },
    settings: settings.data ? mapKeys<UserSettings>(settings.data, camel) : LOCAL_SETTINGS,
  };
}

export async function updateAccount(ctx: OfficeContext, patch: z.infer<typeof profilePatchSchema>) {
  const supabase = requireSupabase(ctx);
  if (patch.fullName !== undefined) {
    const { error } = await supabase.from("profiles").update({ full_name: patch.fullName }).eq("id", ctx.userId);
    if (error) throw new Error("Supabase profile update failed");
  }
  if (patch.settings && Object.keys(patch.settings).length) {
    const { autoRun, reducedMotion, defaultProvider } = patch.settings;
    const row = Object.fromEntries(
      Object.entries({ auto_run: autoRun, reduced_motion: reducedMotion, default_provider: defaultProvider }).filter(([, value]) => value !== undefined),
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

export async function deleteFile(ctx: OfficeContext, fileId: string) {
  const { supabase, path } = await findFile(ctx, fileId);
  const removed = await supabase.storage.from(FILES_BUCKET).remove([path]);
  if (removed.error) throw new HttpError(502, "Falha ao remover o arquivo do armazenamento.");
  const { error } = await supabase.from("files").delete().eq("id", fileId).eq("owner_id", ctx.userId);
  if (error) throw new Error("Supabase file delete failed");
}

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { IntegrationUnavailableError } from "./ai/providers";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Mutations trigger paid AI calls, so reject cross-site requests: the browser
 * must send a same-origin Origin header and a JSON body (which forces a CORS
 * preflight for other origins).
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || originHost !== host) throw new HttpError(403, "Origem não permitida.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Envie JSON.");
  }
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  assertSameOrigin(request);
  const body: unknown = await request.json().catch(() => {
    throw new HttpError(400, "JSON inválido.");
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.issues.map(issue => issue.path.join(".") || "body").join(", ");
    throw new HttpError(422, `Campos inválidos: ${fields}`);
  }
  return parsed.data;
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof IntegrationUnavailableError) {
    return NextResponse.json({ error: `Integração indisponível: ${error.message}` }, { status: 503 });
  }
  console.error("Unhandled API error", error instanceof Error ? error.name : typeof error);
  return NextResponse.json({ error: "Erro interno." }, { status: 500 });
}

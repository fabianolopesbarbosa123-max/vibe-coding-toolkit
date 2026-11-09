import { connection, NextResponse } from "next/server";
import type { OfficeSnapshot } from "@/lib/api-types";
import { computeStats } from "@/lib/stats";
import { getAccount, listFiles } from "@/server/account";
import { listIntegrations } from "@/server/ai/providers";
import { errorResponse } from "@/server/http";
import { getOfficeContext } from "@/server/store";

export async function GET() {
  await connection();
  try {
    const ctx = await getOfficeContext();
    const [state, account, files] = await Promise.all([ctx.store.snapshot(), getAccount(ctx), listFiles(ctx)]);
    const body: OfficeSnapshot = {
      ...state,
      ...account,
      files,
      mode: ctx.mode,
      integrations: listIntegrations(ctx.store.kind),
      stats: computeStats(state),
      storeKind: ctx.store.kind,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

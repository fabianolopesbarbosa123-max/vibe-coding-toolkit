import { connection, NextResponse } from "next/server";
import type { OfficeSnapshot } from "@/lib/api-types";
import { computeStats } from "@/lib/stats";
import { listIntegrations } from "@/server/ai/providers";
import { errorResponse } from "@/server/http";
import { getStore } from "@/server/store";

export async function GET() {
  await connection();
  try {
    const store = getStore();
    const state = await store.snapshot();
    const body: OfficeSnapshot = {
      ...state,
      integrations: listIntegrations(store.kind),
      stats: computeStats(state),
      storeKind: store.kind,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

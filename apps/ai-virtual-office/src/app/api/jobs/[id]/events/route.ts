import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError } from "@/server/http";
import { listJobEvents } from "@/server/jobs";
import { getOfficeContext } from "@/server/store";

export async function GET(_request: Request, route: RouteContext<"/api/jobs/[id]/events">) {
  await connection();
  try {
    const id = z.uuid().safeParse((await route.params).id);
    if (!id.success) throw new HttpError(404, "Execução não encontrada.");
    const events = await listJobEvents(await getOfficeContext(), id.data);
    return NextResponse.json({ events }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { cancelJob } from "@/server/jobs";
import { getOfficeContext } from "@/server/store";

/** Waiting jobs are cancelled at once; running jobs stop at their worker's next heartbeat. */
export async function POST(request: Request, route: RouteContext<"/api/jobs/[id]/cancel">) {
  try {
    await readJson(request, z.object({}));
    const id = z.uuid().safeParse((await route.params).id);
    if (!id.success) throw new HttpError(404, "Execução não encontrada.");
    return NextResponse.json({ job: await cancelJob(await getOfficeContext(), id.data) });
  } catch (error) {
    return errorResponse(error);
  }
}

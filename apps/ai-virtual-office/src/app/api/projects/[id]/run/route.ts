import { after, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/server/http";
import { enqueueJob } from "@/server/jobs";
import { claimProject, executeProject, prepareProjectRun } from "@/server/orchestrator";
import { getOfficeContext } from "@/server/store";

export const maxDuration = 800;

/** Supabase mode: validates and enqueues; a worker runs it. Local mode: runs in-process. */
export async function POST(request: Request, route: RouteContext<"/api/projects/[id]/run">) {
  try {
    const { id } = await route.params;
    await readJson(request, z.object({}));
    const ctx = await getOfficeContext();
    if (ctx.mode === "supabase") {
      await prepareProjectRun(ctx, id);
      const job = await enqueueJob(ctx, "project_run", { projectId: id });
      return NextResponse.json({ job }, { status: 202 });
    }
    const project = await claimProject(ctx, id);
    after(() => executeProject(ctx, id));
    return NextResponse.json(project, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

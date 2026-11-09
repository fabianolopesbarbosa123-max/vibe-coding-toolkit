import { after, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/server/http";
import { enqueueJob } from "@/server/jobs";
import { claimTask, executeTask, prepareTaskRun } from "@/server/orchestrator";
import { getOfficeContext } from "@/server/store";

export const maxDuration = 300;

/** Supabase mode: validates and enqueues; a worker runs it. Local mode: runs in-process. */
export async function POST(request: Request, route: RouteContext<"/api/tasks/[id]/run">) {
  try {
    const { id } = await route.params;
    await readJson(request, z.object({}));
    const ctx = await getOfficeContext();
    if (ctx.mode === "supabase") {
      const { task } = await prepareTaskRun(ctx, id);
      const job = await enqueueJob(ctx, "task_run", { taskId: id, projectId: task.projectId });
      return NextResponse.json({ job }, { status: 202 });
    }
    const task = await claimTask(ctx, id);
    after(() => executeTask(ctx, id));
    return NextResponse.json(task, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

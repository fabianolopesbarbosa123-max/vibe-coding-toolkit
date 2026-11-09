import { after, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/server/http";
import { claimTask, executeTask } from "@/server/orchestrator";

export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/tasks/[id]/run">) {
  try {
    const { id } = await ctx.params;
    await readJson(request, z.object({}));
    const task = await claimTask(id);
    after(() => executeTask(id));
    return NextResponse.json(task, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

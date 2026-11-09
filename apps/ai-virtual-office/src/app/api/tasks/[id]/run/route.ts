import { after, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/server/http";
import { getOfficeContext } from "@/server/store";
import { claimTask, executeTask } from "@/server/orchestrator";

export const maxDuration = 300;

export async function POST(request: Request, route: RouteContext<"/api/tasks/[id]/run">) {
  try {
    const { id } = await route.params;
    await readJson(request, z.object({}));
    const ctx = await getOfficeContext();
    const task = await claimTask(ctx, id);
    after(() => executeTask(ctx, id));
    return NextResponse.json(task, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

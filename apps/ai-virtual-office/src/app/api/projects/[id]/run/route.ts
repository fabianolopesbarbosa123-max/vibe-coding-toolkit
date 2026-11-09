import { after, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/server/http";
import { claimProject, executeProject } from "@/server/orchestrator";

export const maxDuration = 800;

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/run">) {
  try {
    const { id } = await ctx.params;
    await readJson(request, z.object({}));
    const project = await claimProject(id);
    after(() => executeProject(id));
    return NextResponse.json(project, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

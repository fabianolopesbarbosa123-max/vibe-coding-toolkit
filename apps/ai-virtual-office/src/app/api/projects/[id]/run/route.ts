import { after, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/server/http";
import { getOfficeContext } from "@/server/store";
import { claimProject, executeProject } from "@/server/orchestrator";

export const maxDuration = 800;

export async function POST(request: Request, route: RouteContext<"/api/projects/[id]/run">) {
  try {
    const { id } = await route.params;
    await readJson(request, z.object({}));
    const ctx = await getOfficeContext();
    const project = await claimProject(ctx, id);
    after(() => executeProject(ctx, id));
    return NextResponse.json(project, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

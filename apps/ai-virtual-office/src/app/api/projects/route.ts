import { NextResponse } from "next/server";
import { projectInputSchema } from "@/lib/domain";
import { errorResponse, readJson } from "@/server/http";
import { createProject } from "@/server/orchestrator";

export async function POST(request: Request) {
  try {
    const input = await readJson(request, projectInputSchema);
    return NextResponse.json(await createProject(input.name, input.request), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

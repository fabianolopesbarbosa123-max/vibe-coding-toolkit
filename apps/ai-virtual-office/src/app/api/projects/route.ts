import { NextResponse } from "next/server";
import { projectInputSchema } from "@/lib/domain";
import { errorResponse, readJson } from "@/server/http";
import { createProject } from "@/server/orchestrator";
import { getOfficeContext } from "@/server/store";

export async function POST(request: Request) {
  try {
    const input = await readJson(request, projectInputSchema);
    return NextResponse.json(await createProject(await getOfficeContext(), input.name, input.request), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

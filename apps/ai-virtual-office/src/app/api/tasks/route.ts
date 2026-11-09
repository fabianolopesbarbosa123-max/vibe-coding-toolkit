import { NextResponse } from "next/server";
import { taskInputSchema } from "@/lib/domain";
import { errorResponse, readJson } from "@/server/http";
import { createTask } from "@/server/orchestrator";

export async function POST(request: Request) {
  try {
    const input = await readJson(request, taskInputSchema);
    return NextResponse.json(await createTask(input), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

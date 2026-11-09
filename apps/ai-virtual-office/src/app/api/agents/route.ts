import { NextResponse } from "next/server";
import { agentInputSchema, type Agent } from "@/lib/domain";
import { errorResponse, readJson } from "@/server/http";
import { getOfficeContext } from "@/server/store";

export async function POST(request: Request) {
  try {
    const input = await readJson(request, agentInputSchema);
    const ctx = await getOfficeContext();
    const agent: Agent = {
      id: crypto.randomUUID(),
      ...input,
      status: "idle",
      currentTaskId: null,
      createdAt: new Date().toISOString(),
    };
    await ctx.store.insert("agents", agent);
    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

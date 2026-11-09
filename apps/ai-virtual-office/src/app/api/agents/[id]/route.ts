import { NextResponse } from "next/server";
import { agentPatchSchema } from "@/lib/domain";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { getOfficeContext } from "@/server/store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/agents/[id]">) {
  try {
    const { id } = await ctx.params;
    const patch = await readJson(request, agentPatchSchema);
    const agent = await (await getOfficeContext()).store.update("agents", id, patch);
    if (!agent) throw new HttpError(404, "Agente não encontrado.");
    return NextResponse.json(agent);
  } catch (error) {
    return errorResponse(error);
  }
}

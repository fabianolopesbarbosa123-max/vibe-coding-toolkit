import { after, NextResponse } from "next/server";
import { orchestrateInputSchema } from "@/lib/domain";
import { errorResponse, readJson } from "@/server/http";
import { claimProject, executeProject, planProject, startOrchestration } from "@/server/orchestrator";

export const maxDuration = 800;

/** The CEO plans in a meeting, distributes tasks, and (optionally) the team executes them. */
export async function POST(request: Request) {
  try {
    const input = await readJson(request, orchestrateInputSchema);
    const { project, ceo } = await startOrchestration(input.request);
    after(async () => {
      const planned = await planProject(project.id, ceo);
      if (!planned || !input.autoRun) return;
      try {
        await claimProject(project.id);
        await executeProject(project.id);
      } catch (error) {
        console.error("Project could not start", error instanceof Error ? error.message : typeof error);
      }
    });
    return NextResponse.json(project, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

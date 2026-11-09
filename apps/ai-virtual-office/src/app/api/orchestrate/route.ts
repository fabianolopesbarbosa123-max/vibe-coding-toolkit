import { after, NextResponse } from "next/server";
import { orchestrateInputSchema } from "@/lib/domain";
import { errorResponse, readJson } from "@/server/http";
import { enqueueJob } from "@/server/jobs";
import { claimProject, executeProject, planProject, startOrchestration } from "@/server/orchestrator";
import { getOfficeContext } from "@/server/store";

export const maxDuration = 800;

/** The CEO plans in a meeting, distributes tasks, and (optionally) the team executes them. */
export async function POST(request: Request) {
  try {
    const input = await readJson(request, orchestrateInputSchema);
    const ctx = await getOfficeContext();
    const { project, ceo } = await startOrchestration(ctx, input.request);
    if (ctx.mode === "supabase") {
      try {
        const job = await enqueueJob(ctx, "orchestrate", { projectId: project.id }, { autoRun: input.autoRun });
        return NextResponse.json({ project, job }, { status: 202 });
      } catch (error) {
        await ctx.store.update("projects", project.id, { status: "failed", summary: "Não foi possível enfileirar o planejamento." });
        throw error;
      }
    }
    after(async () => {
      const planned = await planProject(ctx, project.id, ceo);
      if (!planned || !input.autoRun) return;
      try {
        await claimProject(ctx, project.id);
        await executeProject(ctx, project.id);
      } catch (error) {
        console.error("Project could not start", error instanceof Error ? error.message : typeof error);
      }
    });
    return NextResponse.json(project, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

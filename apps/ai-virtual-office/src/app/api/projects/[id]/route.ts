import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteProject } from "@/server/account";
import { assertSameOrigin, errorResponse, HttpError } from "@/server/http";
import { logEvent } from "@/server/ledger";
import { getOfficeContext } from "@/server/store";

const idSchema = z.string().min(1).max(100);

export async function DELETE(request: Request, route: RouteContext<"/api/projects/[id]">) {
  try {
    assertSameOrigin(request, { requireJson: false });
    const parsed = idSchema.safeParse((await route.params).id);
    if (!parsed.success) throw new HttpError(404, "Projeto não encontrado.");
    const ctx = await getOfficeContext();
    const removed = await deleteProject(ctx, parsed.data);
    // Also tells the user's other devices (via Realtime) to refresh.
    await logEvent(ctx, "info", `Projeto excluído: ${removed.name}${removed.files ? ` (${removed.files} arquivo(s) removido(s))` : ""}`);
    return NextResponse.json(removed);
  } catch (error) {
    return errorResponse(error);
  }
}

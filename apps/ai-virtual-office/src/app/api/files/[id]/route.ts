import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteFile, fileDownloadUrl } from "@/server/account";
import { assertSameOrigin, errorResponse, HttpError } from "@/server/http";
import { getOfficeContext } from "@/server/store";

const idSchema = z.uuid();

async function fileId(ctx: RouteContext<"/api/files/[id]">) {
  const parsed = idSchema.safeParse((await ctx.params).id);
  if (!parsed.success) throw new HttpError(404, "Arquivo não encontrado.");
  return parsed.data;
}

/** Redirects to a short-lived signed URL; the bucket itself is private. */
export async function GET(_request: Request, ctx: RouteContext<"/api/files/[id]">) {
  try {
    const url = await fileDownloadUrl(await getOfficeContext(), await fileId(ctx));
    return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  try {
    assertSameOrigin(request, { requireJson: false });
    await deleteFile(await getOfficeContext(), await fileId(ctx));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

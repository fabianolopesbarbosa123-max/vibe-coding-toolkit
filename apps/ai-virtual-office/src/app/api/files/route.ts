import { NextResponse } from "next/server";
import { fileInputSchema } from "@/lib/domain";
import { registerFile } from "@/server/account";
import { errorResponse, readJson } from "@/server/http";
import { getOfficeContext } from "@/server/store";

export async function POST(request: Request) {
  try {
    const input = await readJson(request, fileInputSchema);
    await registerFile(await getOfficeContext(), input);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

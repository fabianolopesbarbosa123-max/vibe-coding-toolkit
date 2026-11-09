import { NextResponse } from "next/server";
import { profilePatchSchema } from "@/lib/domain";
import { updateAccount } from "@/server/account";
import { errorResponse, readJson } from "@/server/http";
import { getOfficeContext } from "@/server/store";

export async function PATCH(request: Request) {
  try {
    const patch = await readJson(request, profilePatchSchema);
    return NextResponse.json(await updateAccount(await getOfficeContext(), patch));
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { adjustWeight } from "@/lib/session/service";

/** Changes the weight for a lift's remaining sets. */
export const POST = withUser(async ({ db, user, request, params }) => {
  const body = await readJson<{ liftId: string; weight: number }>(request);
  if (!body.liftId || typeof body.weight !== "number") {
    return NextResponse.json({ error: "liftId and weight required." }, { status: 400 });
  }
  const weight = await adjustWeight(db, user.id, params.id, body.liftId, body.weight);
  return NextResponse.json({ ok: true, weight });
});

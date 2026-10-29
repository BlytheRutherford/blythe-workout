import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { logSet, logWarmup } from "@/lib/session/service";

export const POST = withUser(async ({ db, user, request }) => {
  const body = await readJson<{ setId: string; kind?: "warmup" | "work"; weight?: number }>(request);
  if (!body.setId) return NextResponse.json({ error: "setId required." }, { status: 400 });
  if (body.kind === "warmup") {
    await logWarmup(db, user.id, body.setId);
    return NextResponse.json({ ok: true, liftCompleted: false });
  }
  const weight = typeof body.weight === "number" ? body.weight : undefined;
  const result = await logSet(db, user.id, body.setId, weight);
  return NextResponse.json({ ok: true, liftCompleted: result.liftCompleted, weight: result.set.actual_weight });
});

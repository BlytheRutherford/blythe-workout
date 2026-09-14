import { NextResponse, after } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { logSet, logWarmup } from "@/lib/session/service";
import { processLiftIfReady } from "@/lib/video/stitch";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = withUser(async ({ db, user, request }) => {
  const body = await readJson<{ setId: string; kind?: "warmup" | "work"; hasClip?: boolean; liftId?: string }>(request);
  if (!body.setId) return NextResponse.json({ error: "setId required." }, { status: 400 });
  if (body.kind === "warmup") {
    await logWarmup(db, user.id, body.setId);
    return NextResponse.json({ ok: true, liftCompleted: false });
  }
  const result = await logSet(db, user.id, body.setId, Boolean(body.hasClip));
  if (result.liftCompleted) {
    // If every clip is already in, this stitches + emails "Day N: <lift>" now; otherwise the last clip upload triggers it.
    const liftId = result.set.lift_id;
    after(() => processLiftIfReady(liftId));
  }
  return NextResponse.json({ ok: true, liftCompleted: result.liftCompleted });
});

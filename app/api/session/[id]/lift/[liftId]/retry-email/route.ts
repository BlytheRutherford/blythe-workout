import { NextResponse, after } from "next/server";
import { withUser } from "@/lib/api";
import { processLiftIfReady } from "@/lib/video/stitch";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Re-runs the stitch + email for one lift (owner only). */
export const POST = withUser(async ({ db, user, params }) => {
  const { data: lift } = await db.from("session_lifts").select("id, status, email_status").eq("id", params.liftId).eq("user_id", user.id).maybeSingle();
  if (!lift) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (lift.status !== "completed") return NextResponse.json({ error: "Lift not complete." }, { status: 409 });
  const liftId = lift.id as string;
  after(() => processLiftIfReady(liftId, true));
  return NextResponse.json({ ok: true });
});

import { NextResponse, after } from "next/server";
import { withUser } from "@/lib/api";
import { completeSession, getSessionById } from "@/lib/session/service";
import { processLiftIfReady } from "@/lib/video/stitch";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Closes the day. Any completed lift still waiting on a clip that never arrived is emailed with what exists. */
export const POST = withUser(async ({ db, user, params }) => {
  const session = await completeSession(db, user.id, params.id);
  const bundle = await getSessionById(db, user.id, params.id);
  const stuck = (bundle?.lifts ?? []).filter((l) => l.status === "completed" && (l.email_status === "pending" || l.email_status === "failed")).map((l) => l.id);
  if (stuck.length) {
    after(async () => {
      for (const id of stuck) await processLiftIfReady(id, true);
    });
  }
  return NextResponse.json({ ok: true, dayNumber: session.day_number });
});

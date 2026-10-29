import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { completeSession } from "@/lib/session/service";

/** Closes the day. Lifts left unfinished count as misses. */
export const POST = withUser(async ({ db, user, params }) => {
  const session = await completeSession(db, user.id, params.id);
  return NextResponse.json({ ok: true, dayNumber: session.day_number });
});

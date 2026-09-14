import { NextResponse, after } from "next/server";
import { withUser } from "@/lib/api";
import { completeSession } from "@/lib/session/service";
import { stitchAndEmail } from "@/lib/video/stitch";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = withUser(async ({ db, user, params }) => {
  const session = await completeSession(db, user.id, params.id);
  if (session.email_status === "pending" || session.email_status === "failed") {
    after(async () => {
      try {
        await stitchAndEmail(session.id);
      } catch (e) {
        console.error("stitchAndEmail crashed", e);
      }
    });
  }
  return NextResponse.json({ ok: true, dayNumber: session.day_number });
});

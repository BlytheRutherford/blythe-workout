import { NextResponse, after } from "next/server";
import { withUser } from "@/lib/api";
import { stitchAndEmail } from "@/lib/video/stitch";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Re-runs the day pipeline (stitch if needed, then email). */
export const POST = withUser(async ({ db, user, params }) => {
  const { data: session } = await db.from("sessions").select("id, status, email_status").eq("id", params.id).eq("user_id", user.id).maybeSingle();
  if (!session) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (session.status !== "complete") return NextResponse.json({ error: "Day not complete." }, { status: 409 });
  if (session.email_status === "stitching") return NextResponse.json({ ok: true, already: true });
  await db.from("sessions").update({ email_status: "pending", email_error: null }).eq("id", session.id);
  after(async () => {
    try {
      await stitchAndEmail(session.id);
    } catch (e) {
      console.error("retry stitchAndEmail crashed", e);
    }
  });
  return NextResponse.json({ ok: true });
});

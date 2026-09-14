import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";

/** Day status + per-lift email statuses (polled by the Day-complete screen). */
export const GET = withUser(async ({ db, user, params }) => {
  const { data } = await db
    .from("sessions")
    .select("id, status, day_number")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: lifts } = await db
    .from("session_lifts")
    .select("id, display_name, order_index, status, email_status, email_to, email_error, email_subject, video_kind")
    .eq("session_id", params.id)
    .eq("user_id", user.id)
    .order("order_index");
  return NextResponse.json({ ...data, lifts: lifts ?? [] });
});

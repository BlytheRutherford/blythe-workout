import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";

export const GET = withUser(async ({ db, user, params }) => {
  const { data } = await db
    .from("sessions")
    .select("id, status, day_number, email_status, email_to, email_error, video_kind")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(data);
});

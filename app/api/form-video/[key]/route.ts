import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";

/** Redirects to a short-lived signed URL for the official form clip of a lift. */
export const GET = withUser(async ({ db, params }) => {
  const { data } = await db.from("form_videos").select("storage_path").eq("exercise_key", params.key).maybeSingle();
  if (!data) return NextResponse.json({ error: "No form video." }, { status: 404 });
  const { data: signed, error } = await db.storage.from("form").createSignedUrl(data.storage_path, 3600);
  if (error || !signed) return NextResponse.json({ error: error?.message ?? "Could not sign." }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
});

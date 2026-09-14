import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";

/** The 2-mile walk lives outside the app; this only toggles the gray note. */
export const POST = withUser(async ({ db, user, request, params }) => {
  const body = await readJson<{ done: boolean }>(request);
  const { error } = await db.from("sessions").update({ walk_done: Boolean(body.done) }).eq("id", params.id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

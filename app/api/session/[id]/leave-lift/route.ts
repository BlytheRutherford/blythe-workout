import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { leaveLift } from "@/lib/session/service";

export const POST = withUser(async ({ db, user, request, params }) => {
  const body = await readJson<{ liftId: string }>(request);
  if (!body.liftId) return NextResponse.json({ error: "liftId required." }, { status: 400 });
  await leaveLift(db, user.id, params.id, body.liftId);
  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { skipRest } from "@/lib/session/service";

export const POST = withUser(async ({ db, user, request }) => {
  const body = await readJson<{ setId: string }>(request);
  if (!body.setId) return NextResponse.json({ error: "setId required." }, { status: 400 });
  await skipRest(db, user.id, body.setId);
  return NextResponse.json({ ok: true });
});

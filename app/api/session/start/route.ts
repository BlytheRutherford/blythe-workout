import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { isValidTz, localDay } from "@/lib/session/dates";
import { startSession } from "@/lib/session/service";

export const POST = withUser(async ({ db, user, request }) => {
  const body = await readJson<{ tz?: string }>(request);
  const day = localDay(isValidTz(body.tz) ? body.tz : "America/Chicago");
  const bundle = await startSession(db, user.id, day);
  return NextResponse.json({ sessionId: bundle.session.id });
});

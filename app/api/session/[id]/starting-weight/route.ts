import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { isValidTz, localDay } from "@/lib/session/dates";
import { setStartingWeight } from "@/lib/session/service";

export const POST = withUser(async ({ db, user, request }) => {
  const body = await readJson<{ exerciseKey: string; weight: number; tz?: string }>(request);
  if (!body.exerciseKey || typeof body.weight !== "number") {
    return NextResponse.json({ error: "exerciseKey and weight required." }, { status: 400 });
  }
  const day = localDay(isValidTz(body.tz) ? body.tz : "America/Chicago");
  const weight = await setStartingWeight(db, user.id, body.exerciseKey, body.weight, day.ymd);
  return NextResponse.json({ ok: true, weight });
});

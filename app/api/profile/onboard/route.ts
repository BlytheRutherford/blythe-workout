import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { ACTIVITY_LEVELS, CALIBRATION_DAYS, type ActivityLevel } from "@/lib/engine";
import { ensureExerciseStates, getProfile, resetExerciseStates } from "@/lib/session/service";

export const POST = withUser(async ({ db, user, request }) => {
  const b = await readJson<{ heightCm: number; weightLb: number; activity: string }>(request);
  const activity = ACTIVITY_LEVELS.find((a) => a.value === b.activity)?.value as ActivityLevel | undefined;
  if (!activity) return NextResponse.json({ error: "Invalid activity level." }, { status: 400 });
  const heightCm = Number(b.heightCm);
  const weightLb = Number(b.weightLb);
  if (!(heightCm > 90 && heightCm < 260) || !(weightLb >= 60 && weightLb <= 500)) {
    return NextResponse.json({ error: "Invalid height or weight." }, { status: 400 });
  }
  const profile = await getProfile(db, user.id);
  if (!profile) return NextResponse.json({ error: "Profile missing." }, { status: 500 });
  const firstTime = !profile.onboarded_at;
  const calibrationEnds = new Date(Date.now() + (CALIBRATION_DAYS - 1) * 86400000).toISOString().slice(0, 10);

  const { error } = await db
    .from("users")
    .update({
      height_cm: heightCm,
      weight_lb: weightLb,
      activity_level: activity,
      onboarded_at: profile.onboarded_at ?? new Date().toISOString(),
      ...(firstTime ? { calibration_ends_on: calibrationEnds } : {}),
    })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (firstTime) await resetExerciseStates(db, user.id, activity, weightLb);
  else await ensureExerciseStates(db, user.id, activity, weightLb);
  return NextResponse.json({ ok: true });
});

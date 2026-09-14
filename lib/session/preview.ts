import type { SupabaseClient } from "@supabase/supabase-js";
import { DAYS, displayName, snapToLegal } from "@/lib/engine";
import { ensureExerciseStates, getProfile } from "./service";
import { type LocalDay, weekDates } from "./dates";
import type { ExerciseRow, StateRow } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface PreviewLift {
  key: string;
  name: string;
  weight: number;
  reps: number;
  repUnit: string | null;
  isBodyweight: boolean;
}

/** Today's prescriptions without creating a session (for the Today list). */
export async function previewToday(db: Db, userId: string, day: LocalDay): Promise<PreviewLift[]> {
  if (day.dayIndex === 0) return [];
  const profile = await getProfile(db, userId);
  if (profile) await ensureExerciseStates(db, userId, profile.activity_level ?? "moderately_active", profile.weight_lb);
  const [{ data: exercises }, { data: states }] = await Promise.all([
    db.from("exercises").select("*").eq("slot_day", day.dayIndex).order("order_index"),
    db.from("user_exercise_state").select("*").eq("user_id", userId),
  ]);
  const byKey = new Map<string, StateRow>(((states ?? []) as StateRow[]).map((s) => [s.exercise_key, s]));
  return ((exercises ?? []) as ExerciseRow[]).map((ex) => {
    const st = byKey.get(ex.exercise_key);
    return {
      key: ex.exercise_key,
      name: displayName({ name: ex.name, variantRule: ex.variant_rule as "thu-press" | undefined }, day.date),
      weight: ex.is_bodyweight ? 0 : snapToLegal(Number(st?.working_weight ?? ex.seed_weight), "up"),
      reps: st?.target_reps ?? ex.seed_reps,
      repUnit: ex.rep_unit,
      isBodyweight: ex.is_bodyweight,
    };
  });
}

export interface PreviewDay {
  dayIndex: number;
  ymd: string;
  short: string;
  name: string;
  isToday: boolean;
  status: "done" | "in_progress" | "upcoming" | "past";
  dayNumber: number | null;
  sessionId: string | null;
  lifts: (PreviewLift & { done?: boolean; missed?: boolean })[];
}

/**
 * The whole training week. Days already trained show what was actually
 * prescribed that day; days still ahead show what the engine will prescribe
 * if today's work goes as planned.
 */
export async function previewWeek(db: Db, userId: string, today: LocalDay): Promise<PreviewDay[]> {
  const profile = await getProfile(db, userId);
  if (profile) await ensureExerciseStates(db, userId, profile.activity_level ?? "moderately_active", profile.weight_lb);
  const days = weekDates(today);

  const [{ data: exercises }, { data: states }, { data: sessions }] = await Promise.all([
    db.from("exercises").select("*").order("slot_day").order("order_index"),
    db.from("user_exercise_state").select("*").eq("user_id", userId),
    db
      .from("sessions")
      .select("id, session_date, status, day_number")
      .eq("user_id", userId)
      .gte("session_date", days[0].ymd)
      .lte("session_date", days[4].ymd),
  ]);

  const sessionRows = (sessions ?? []) as { id: string; session_date: string; status: string; day_number: number | null }[];
  const liveIds = sessionRows.filter((s) => s.status !== "abandoned").map((s) => s.id);
  const { data: liftRows } = liveIds.length
    ? await db
        .from("session_lifts")
        .select("session_id, exercise_key, display_name, order_index, prescribed_weight, prescribed_reps, status")
        .in("session_id", liveIds)
        .order("order_index")
    : { data: [] };

  const byKey = new Map<string, StateRow>(((states ?? []) as StateRow[]).map((s) => [s.exercise_key, s]));
  const exByDay = new Map<number, ExerciseRow[]>();
  for (const ex of (exercises ?? []) as ExerciseRow[]) {
    exByDay.set(ex.slot_day, [...(exByDay.get(ex.slot_day) ?? []), ex]);
  }

  return days.map(({ dayIndex, ymd, date }) => {
    const def = DAYS[dayIndex - 1];
    const session = sessionRows.find((s) => s.session_date === ymd && s.status !== "abandoned");
    const dayExercises = exByDay.get(dayIndex) ?? [];
    const logged = ((liftRows ?? []) as { session_id: string; exercise_key: string; display_name: string; order_index: number; prescribed_weight: number; prescribed_reps: number; status: string }[])
      .filter((l) => session && l.session_id === session.id)
      .sort((a, b) => a.order_index - b.order_index);

    const lifts =
      logged.length > 0
        ? logged.map((l) => {
            const ex = dayExercises.find((e) => e.exercise_key === l.exercise_key);
            return {
              key: l.exercise_key,
              name: l.display_name,
              weight: Number(l.prescribed_weight),
              reps: l.prescribed_reps,
              repUnit: ex?.rep_unit ?? null,
              isBodyweight: ex?.is_bodyweight ?? false,
              done: l.status === "completed",
              missed: l.status === "missed",
            };
          })
        : dayExercises.map((ex) => {
            const st = byKey.get(ex.exercise_key);
            return {
              key: ex.exercise_key,
              name: displayName({ name: ex.name, variantRule: ex.variant_rule as "thu-press" | undefined }, date),
              weight: ex.is_bodyweight ? 0 : snapToLegal(Number(st?.working_weight ?? ex.seed_weight), "up"),
              reps: st?.target_reps ?? ex.seed_reps,
              repUnit: ex.rep_unit,
              isBodyweight: ex.is_bodyweight,
            };
          });

    const status: PreviewDay["status"] =
      session?.status === "complete" ? "done" : session?.status === "in_progress" ? "in_progress" : ymd < today.ymd ? "past" : "upcoming";

    return {
      dayIndex,
      ymd,
      short: def.short,
      name: def.name,
      isToday: ymd === today.ymd,
      status,
      dayNumber: session?.day_number ?? null,
      sessionId: session && session.status === "in_progress" ? session.id : null,
      lifts,
    };
  });
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { DAYS, displayName, nextDayInRotation, snapToLegal, variantFor, WEEKLY_TARGET } from "@/lib/engine";
import { ensureExerciseStates, getProfile, trainedDays, type TrainedDay } from "./service";
import { type LocalDay, weekOf } from "./dates";
import type { ExerciseRow, StateRow } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface PreviewLift {
  key: string;
  name: string;
  /** Per-set weights, in set order. One entry when every set uses the same weight. */
  weights: number[];
  reps: number;
  repUnit: string | null;
  isBodyweight: boolean;
  done?: boolean;
  missed?: boolean;
}

/** What the engine will prescribe for a workout in the rotation, without creating a session. */
export async function previewWorkout(db: Db, userId: string, dayIndex: number, date: Date): Promise<PreviewLift[]> {
  const profile = await getProfile(db, userId);
  if (profile) await ensureExerciseStates(db, userId, profile.activity_level ?? "moderately_active", profile.weight_lb);
  const [{ data: exercises }, { data: states }] = await Promise.all([
    db.from("exercises").select("*").eq("slot_day", dayIndex).order("order_index"),
    db.from("user_exercise_state").select("*").eq("user_id", userId),
  ]);
  const byKey = new Map<string, StateRow>(((states ?? []) as StateRow[]).map((s) => [s.exercise_key, s]));
  return ((exercises ?? []) as ExerciseRow[]).map((ex) => {
    const st = byKey.get(ex.exercise_key);
    const vi = st?.variant_index ?? 0;
    const v = variantFor(ex.exercise_key, vi);
    return {
      key: ex.exercise_key,
      name: displayName({ name: ex.name, variantRule: ex.variant_rule as "thu-press" | undefined }, date, vi, ex.exercise_key),
      weights: [v.isBodyweight ? 0 : snapToLegal(Number(st?.working_weight ?? v.startWeight), "up")],
      reps: Math.max(v.rangeMin, st?.target_reps ?? v.rangeMin),
      repUnit: v.repUnit ?? null,
      isBodyweight: v.isBodyweight,
    };
  });
}

/** The lifts of workouts already done, with the weights actually used on each set. */
async function loggedLifts(db: Db, sessionIds: string[]): Promise<Map<string, PreviewLift[]>> {
  const out = new Map<string, PreviewLift[]>();
  if (sessionIds.length === 0) return out;
  const [{ data: lifts }, { data: sets }] = await Promise.all([
    db
      .from("session_lifts")
      .select("id, session_id, exercise_key, display_name, variant_index, order_index, prescribed_weight, prescribed_reps, status")
      .in("session_id", sessionIds)
      .order("order_index"),
    db.from("session_sets").select("lift_id, set_number, prescribed_weight, actual_weight, result").in("session_id", sessionIds).eq("kind", "work"),
  ]);
  const setsByLift = new Map<string, { set_number: number; prescribed_weight: number; actual_weight: number | null; result: string }[]>();
  for (const s of (sets ?? []) as { lift_id: string; set_number: number; prescribed_weight: number; actual_weight: number | null; result: string }[]) {
    setsByLift.set(s.lift_id, [...(setsByLift.get(s.lift_id) ?? []), s]);
  }
  for (const l of (lifts ?? []) as {
    id: string;
    session_id: string;
    exercise_key: string;
    display_name: string;
    variant_index: number;
    order_index: number;
    prescribed_weight: number;
    prescribed_reps: number;
    status: string;
  }[]) {
    const v = variantFor(l.exercise_key, l.variant_index ?? 0);
    const work = (setsByLift.get(l.id) ?? []).sort((a, b) => a.set_number - b.set_number);
    const logged = work.filter((s) => s.result === "completed").map((s) => Number(s.actual_weight ?? s.prescribed_weight));
    out.set(l.session_id, [
      ...(out.get(l.session_id) ?? []),
      {
        key: l.exercise_key,
        name: l.display_name,
        weights: v.isBodyweight ? [0] : logged.length ? logged : [Number(l.prescribed_weight)],
        reps: l.prescribed_reps,
        repUnit: v.repUnit ?? null,
        isBodyweight: v.isBodyweight,
        done: l.status === "completed",
        missed: l.status === "missed",
      },
    ]);
  }
  return out;
}

export interface WeekCalendarDay {
  ymd: string;
  weekday: number;
  isToday: boolean;
  isPast: boolean;
  /** The workout trained that day, if any. */
  trained: TrainedDay | null;
}

export interface WeekWorkout {
  dayIndex: number;
  label: string;
  name: string;
  /** done this week, in progress today, or still to come */
  state: "done" | "in_progress" | "upcoming";
  ymd: string | null;
  dayNumber: number | null;
  sessionId: string | null;
  lifts: PreviewLift[];
}

export interface WeekPlan {
  calendar: WeekCalendarDay[];
  /** Workouts done (or underway) this Monday–Sunday week. */
  count: number;
  target: number;
  /** Done this week in order, then the rest of the rotation to reach the target. */
  workouts: WeekWorkout[];
  /** The next workout in the rotation (what Start would begin today). */
  nextDay: number;
}

/**
 * The Monday–Sunday week: which days were trained, how many of the five are
 * done, and what the rest of the rotation will prescribe if today's work goes
 * as planned.
 */
export async function weekPlan(db: Db, userId: string, today: LocalDay): Promise<WeekPlan> {
  const dates = weekOf(today);
  const first = dates[0].ymd;
  const last = dates[6].ymd;
  const [thisWeek, all] = await Promise.all([trainedDays(db, userId, first, last), trainedDays(db, userId, null, null)]);
  const latest = all.at(-1);
  // An in-progress workout today is the current one; the rotation continues after it.
  const lastDay = latest?.dayIndex ?? null;
  const nextDay = latest?.status === "in_progress" ? latest.dayIndex : nextDayInRotation(lastDay);

  const logged = await loggedLifts(
    db,
    thisWeek.map((d) => d.sessionId),
  );
  const workouts: WeekWorkout[] = thisWeek.map((d) => ({
    dayIndex: d.dayIndex,
    label: DAYS[d.dayIndex - 1].label,
    name: DAYS[d.dayIndex - 1].name,
    state: d.status === "in_progress" ? "in_progress" : "done",
    ymd: d.ymd,
    dayNumber: d.dayNumber,
    sessionId: d.status === "in_progress" ? d.sessionId : null,
    lifts: logged.get(d.sessionId) ?? [],
  }));

  const remaining = Math.max(0, WEEKLY_TARGET - thisWeek.length);
  let upcoming = latest?.status === "in_progress" ? nextDayInRotation(latest.dayIndex) : nextDay;
  for (let i = 0; i < remaining; i++) {
    workouts.push({
      dayIndex: upcoming,
      label: DAYS[upcoming - 1].label,
      name: DAYS[upcoming - 1].name,
      state: "upcoming",
      ymd: null,
      dayNumber: null,
      sessionId: null,
      lifts: await previewWorkout(db, userId, upcoming, today.date),
    });
    upcoming = nextDayInRotation(upcoming);
  }

  return {
    calendar: dates.map((d) => ({
      ymd: d.ymd,
      weekday: d.weekday,
      isToday: d.ymd === today.ymd,
      isPast: d.ymd < today.ymd,
      trained: thisWeek.find((t) => t.ymd === d.ymd) ?? null,
    })),
    count: thisWeek.length,
    target: WEEKLY_TARGET,
    workouts,
    nextDay,
  };
}

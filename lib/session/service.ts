import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyResult,
  displayName,
  EXERCISE_KEYS,
  exerciseByKey,
  liftResultFromSets,
  nextDayInRotation,
  settleLift,
  snapToLegal,
  specForVariant,
  startingState,
  variantFor,
  warmupSets,
  type ActivityLevel,
  type ExerciseState,
  type LiftResult,
} from "@/lib/engine";
import { type LocalDay, ymdToDate } from "./dates";
import type { ExerciseRow, LiftRow, ProfileRow, SessionBundle, SessionRow, SetRow, StateRow } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

function toState(row: StateRow): ExerciseState {
  return {
    weight: num(row.working_weight),
    targetReps: row.target_reps,
    consecutiveHits: row.consecutive_hits,
    consecutiveMisses: row.consecutive_misses,
    variantIndex: row.variant_index ?? 0,
    note: row.note,
  };
}

// ---------------------------------------------------------------- profile

export async function getProfile(db: Db, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  if (error) throw new ServiceError(error.message, 500);
  return (data as ProfileRow | null) ?? null;
}

function stateRow(userId: string, key: string, activity: ActivityLevel, bodyweightLb: number | null) {
  const def = exerciseByKey(key)!;
  const s = startingState(def, activity, bodyweightLb);
  return {
    user_id: userId,
    exercise_key: key,
    working_weight: s.weight,
    target_reps: s.targetReps,
    consecutive_hits: 0,
    consecutive_misses: 0,
    variant_index: 0,
    note: null,
  };
}

/** Creates any missing per-lift state rows from the activity level. Idempotent. */
export async function ensureExerciseStates(
  db: Db,
  userId: string,
  activity: ActivityLevel,
  bodyweightLb: number | null,
): Promise<void> {
  const { data: existing, error } = await db.from("user_exercise_state").select("exercise_key").eq("user_id", userId);
  if (error) throw new ServiceError(error.message, 500);
  const have = new Set((existing ?? []).map((r: { exercise_key: string }) => r.exercise_key));
  const rows = EXERCISE_KEYS.filter((k) => !have.has(k)).map((key) => stateRow(userId, key, activity, bodyweightLb));
  if (rows.length === 0) return;
  const { error: insErr } = await db.from("user_exercise_state").insert(rows);
  if (insErr) throw new ServiceError(insErr.message, 500);
}

/** Re-derive every starting load from a (new) activity level. First onboarding only. */
export async function resetExerciseStates(db: Db, userId: string, activity: ActivityLevel, bodyweightLb: number | null) {
  const rows = EXERCISE_KEYS.map((key) => stateRow(userId, key, activity, bodyweightLb));
  const { error } = await db.from("user_exercise_state").upsert(rows, { onConflict: "user_id,exercise_key" });
  if (error) throw new ServiceError(error.message, 500);
}

// ---------------------------------------------------------------- sessions

async function loadBundle(db: Db, session: SessionRow): Promise<SessionBundle> {
  const [{ data: lifts, error: lErr }, { data: sets, error: sErr }, { data: forms }] = await Promise.all([
    db.from("session_lifts").select("*").eq("session_id", session.id).order("order_index"),
    db.from("session_sets").select("*").eq("session_id", session.id).order("kind").order("set_number"),
    db.from("form_videos").select("exercise_key, storage_path"),
  ]);
  if (lErr) throw new ServiceError(lErr.message, 500);
  if (sErr) throw new ServiceError(sErr.message, 500);
  const liftRows = (lifts ?? []) as (LiftRow & { last_weight: number | null; last_reps: number | null })[];

  // By id, not by day: a lift retired from the program still renders in old workouts.
  const ids = Array.from(new Set(liftRows.map((l) => l.exercise_id)));
  const { data: exercises, error: eErr } = ids.length ? await db.from("exercises").select("*").in("id", ids) : { data: [], error: null };
  if (eErr) throw new ServiceError(eErr.message, 500);
  const exById = new Map<number, ExerciseRow>(((exercises ?? []) as ExerciseRow[]).map((e) => [e.id, e]));
  const formByKey = new Map<string, string>(
    ((forms ?? []) as { exercise_key: string; storage_path: string }[]).map((f) => [f.exercise_key, f.storage_path]),
  );
  const setsByLift = new Map<string, SetRow[]>();
  for (const s of (sets ?? []) as SetRow[]) {
    const arr = setsByLift.get(s.lift_id) ?? [];
    arr.push({ ...s, prescribed_weight: num(s.prescribed_weight), actual_weight: s.actual_weight == null ? null : num(s.actual_weight) });
    setsByLift.set(s.lift_id, arr);
  }
  const order = { warmup: 0, work: 1 } as const;
  return {
    session,
    lifts: liftRows.map((l) => {
      const v = variantFor(l.exercise_key, l.variant_index ?? 0);
      return {
        ...l,
        prescribed_weight: num(l.prescribed_weight),
        sets: (setsByLift.get(l.id) ?? []).sort((a, b) => order[a.kind] - order[b.kind] || a.set_number - b.set_number),
        // the rep unit and bodyweight flag travel with the rung ("/side" once a lift goes unilateral)
        exercise: { ...exById.get(l.exercise_id)!, rep_unit: v.repUnit ?? null, is_bodyweight: v.isBodyweight },
        lastLog: l.last_weight != null && l.last_reps != null ? { weight: num(l.last_weight), reps: l.last_reps } : null,
        formVideoPath: formByKey.get(l.exercise_key) ?? null,
      };
    }),
  };
}

export async function getSessionById(db: Db, userId: string, sessionId: string): Promise<SessionBundle | null> {
  const { data, error } = await db.from("sessions").select("*").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (error) throw new ServiceError(error.message, 500);
  if (!data) return null;
  return loadBundle(db, data as SessionRow);
}

export async function getSessionForDate(db: Db, userId: string, ymd: string): Promise<SessionBundle | null> {
  const { data, error } = await db
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("session_date", ymd)
    .maybeSingle();
  if (error) throw new ServiceError(error.message, 500);
  if (!data) return null;
  return loadBundle(db, data as SessionRow);
}

/**
 * Any in-progress session from an earlier day is closed: lifts that were
 * started but not finished count as misses; untouched lifts are left alone.
 */
export async function finalizeStaleSessions(db: Db, userId: string, todayYmd: string): Promise<void> {
  const { data: stale, error } = await db
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .lt("session_date", todayYmd);
  if (error) throw new ServiceError(error.message, 500);
  for (const s of (stale ?? []) as SessionRow[]) {
    const bundle = await loadBundle(db, s);
    for (const lift of bundle.lifts) {
      if (lift.status === "in_progress") await resolveLift(db, userId, lift, "miss", liftWeightSoFar(lift));
    }
    await db.from("sessions").update({ status: "abandoned" }).eq("id", s.id);
  }
}

/** Of these sessions, the ones where at least one working set was logged. */
async function sessionsWithWork(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db
    .from("session_sets")
    .select("session_id")
    .in("session_id", ids)
    .eq("kind", "work")
    .eq("result", "completed");
  if (error) throw new ServiceError(error.message, 500);
  return new Set(((data ?? []) as { session_id: string }[]).map((r) => r.session_id));
}

export interface TrainedDay {
  sessionId: string;
  ymd: string;
  dayIndex: number;
  dayNumber: number | null;
  status: "complete" | "in_progress" | "abandoned";
}

/**
 * Workouts that count, oldest first: finished ones, ones closed on a later day
 * with some work logged, and today's in-progress one. Sessions before the
 * profile's program_start_on (set when lifts are reset) are ignored.
 */
export async function trainedDays(db: Db, userId: string, fromYmd: string | null, toYmd: string | null): Promise<TrainedDay[]> {
  const profile = await getProfile(db, userId);
  const start = [fromYmd, profile?.program_start_on ?? null].filter(Boolean).sort().at(-1) ?? null;
  let q = db.from("sessions").select("id, session_date, day_index, day_number, status").eq("user_id", userId);
  if (start) q = q.gte("session_date", start);
  if (toYmd) q = q.lte("session_date", toYmd);
  const { data, error } = await q.order("session_date");
  if (error) throw new ServiceError(error.message, 500);
  const rows = (data ?? []) as { id: string; session_date: string; day_index: number; day_number: number | null; status: TrainedDay["status"] }[];
  const worked = await sessionsWithWork(
    db,
    rows.filter((r) => r.status === "abandoned").map((r) => r.id),
  );
  return rows
    .filter((r) => r.status !== "abandoned" || worked.has(r.id))
    .map((r) => ({ sessionId: r.id, ymd: r.session_date, dayIndex: r.day_index, dayNumber: r.day_number, status: r.status }));
}

/**
 * The next workout in the rotation: the day after the last one trained.
 * Skipping calendar days never skips a workout.
 */
export async function nextWorkoutDay(db: Db, userId: string): Promise<number> {
  const days = await trainedDays(db, userId, null, null);
  const last = days.filter((d) => d.status !== "in_progress").at(-1);
  return nextDayInRotation(last?.dayIndex ?? null);
}

/** Creates today's session (prescriptions + sets) if it doesn't exist. */
export async function startSession(db: Db, userId: string, day: LocalDay): Promise<SessionBundle> {
  await finalizeStaleSessions(db, userId, day.ymd);

  const existing = await getSessionForDate(db, userId, day.ymd);
  if (existing) return existing;

  const profile = await getProfile(db, userId);
  if (!profile) throw new ServiceError("Profile missing.", 500);
  await ensureExerciseStates(db, userId, profile.activity_level ?? "moderately_active", profile.weight_lb);
  const dayIndex = await nextWorkoutDay(db, userId);

  const [{ data: exercises, error: eErr }, { data: states, error: sErr }] = await Promise.all([
    db.from("exercises").select("*").eq("slot_day", dayIndex).order("order_index"),
    db.from("user_exercise_state").select("*").eq("user_id", userId),
  ]);
  if (eErr) throw new ServiceError(eErr.message, 500);
  if (sErr) throw new ServiceError(sErr.message, 500);
  const stateByKey = new Map<string, StateRow>((states as StateRow[]).map((s) => [s.exercise_key, s]));

  // Lifetime workout number is fixed when the workout starts.
  const { count: doneCount } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "complete");
  const { data: sessionRow, error: insErr } = await db
    .from("sessions")
    .insert({ user_id: userId, session_date: day.ymd, day_index: dayIndex, status: "in_progress", day_number: (doneCount ?? 0) + 1 })
    .select("*")
    .single();
  if (insErr) {
    // Race: created concurrently.
    const again = await getSessionForDate(db, userId, day.ymd);
    if (again) return again;
    throw new ServiceError(insErr.message, 500);
  }
  const session = sessionRow as SessionRow;
  const date = ymdToDate(day.ymd);

  const liftRows = (exercises as ExerciseRow[]).map((ex) => {
    const st = stateByKey.get(ex.exercise_key);
    const vi = st?.variant_index ?? 0;
    const v = variantFor(ex.exercise_key, vi);
    const weight = v.isBodyweight ? 0 : snapToLegal(num(st?.working_weight ?? v.startWeight), "up");
    const reps = Math.max(v.rangeMin, st?.target_reps ?? v.rangeMin);
    return {
      session_id: session.id,
      user_id: userId,
      exercise_id: ex.id,
      exercise_key: ex.exercise_key,
      display_name: displayName({ name: ex.name, variantRule: ex.variant_rule as "thu-press" | undefined }, date, vi, ex.exercise_key),
      variant_index: vi,
      order_index: ex.order_index,
      prescribed_weight: weight,
      prescribed_reps: reps,
      rest_seconds: ex.rest_seconds,
      note: st?.note ?? null,
      status: "pending",
      last_weight: st?.last_hit_weight ?? null,
      last_reps: st?.last_hit_reps ?? null,
    };
  });
  const { data: lifts, error: lErr } = await db.from("session_lifts").insert(liftRows).select("*");
  if (lErr) throw new ServiceError(lErr.message, 500);

  const setRows: Record<string, unknown>[] = [];
  for (const lift of lifts as LiftRow[]) {
    if (lift.order_index === 1) {
      warmupSets(num(lift.prescribed_weight), lift.prescribed_reps, specForVariant(lift.exercise_key, lift.variant_index ?? 0)).forEach((w, i) =>
        setRows.push({
          session_id: session.id,
          lift_id: lift.id,
          user_id: userId,
          kind: "warmup",
          set_number: i + 1,
          prescribed_weight: w.weight,
          prescribed_reps: w.reps,
        }),
      );
    }
    for (let n = 1; n <= 3; n++) {
      setRows.push({
        session_id: session.id,
        lift_id: lift.id,
        user_id: userId,
        kind: "work",
        set_number: n,
        prescribed_weight: num(lift.prescribed_weight),
        prescribed_reps: lift.prescribed_reps,
      });
    }
  }
  const { error: setErr } = await db.from("session_sets").insert(setRows);
  if (setErr) throw new ServiceError(setErr.message, 500);

  return loadBundle(db, session);
}

// ---------------------------------------------------------------- lifts & sets

type LiftWithSets = LiftRow & { sets: SetRow[] };

function workSets(lift: LiftWithSets): SetRow[] {
  return lift.sets.filter((s) => s.kind === "work").sort((a, b) => a.set_number - b.set_number);
}

/** The weight a lift was last being done at: the latest logged set, else the (possibly adjusted) next set. */
function liftWeightSoFar(lift: LiftWithSets): number {
  const work = workSets(lift);
  const done = work.filter((s) => s.result === "completed");
  if (done.length) return num(done[done.length - 1].actual_weight ?? done[done.length - 1].prescribed_weight);
  const next = work.find((s) => s.result === "pending");
  return num(next?.prescribed_weight ?? lift.prescribed_weight);
}

/**
 * Applies the engine once per lift and records the outcome. Idempotent.
 * `weight` is what the lift is judged at: the settled weight for a finished
 * lift (see settleLift), or the weight it was last done at for a miss.
 */
async function resolveLift(db: Db, userId: string, lift: LiftRow, result: LiftResult, weight: number) {
  if (lift.progression_applied) return;
  const { data: stRow, error } = await db
    .from("user_exercise_state")
    .select("*")
    .eq("user_id", userId)
    .eq("exercise_key", lift.exercise_key)
    .maybeSingle();
  if (error) throw new ServiceError(error.message, 500);

  // Judge the lift on the rung it was actually performed on, at the weight actually used.
  const variantIndex = lift.variant_index ?? 0;
  const spec = specForVariant(lift.exercise_key, variantIndex);
  const base = { weight: spec.isBodyweight ? 0 : weight, targetReps: lift.prescribed_reps, variantIndex };
  const current: ExerciseState = stRow
    ? { ...toState(stRow as StateRow), ...base }
    : { ...base, consecutiveHits: 0, consecutiveMisses: 0, note: null };
  const next = applyResult(current, spec, result);
  const graduated = next.variantIndex !== variantIndex;
  const finished = result === "hit" || result === "hold";

  const { error: upErr } = await db.from("user_exercise_state").upsert(
    {
      user_id: userId,
      exercise_key: lift.exercise_key,
      working_weight: next.weight,
      target_reps: next.targetReps,
      consecutive_hits: next.consecutiveHits,
      consecutive_misses: next.consecutiveMisses,
      variant_index: next.variantIndex,
      note: next.note,
      // A new movement has no comparable history, so the "last time" caption resets.
      last_hit_weight: graduated ? null : finished ? base.weight : (stRow?.last_hit_weight ?? null),
      last_hit_reps: graduated ? null : finished ? lift.prescribed_reps : (stRow?.last_hit_reps ?? null),
      last_logged_at: new Date().toISOString(),
    },
    { onConflict: "user_id,exercise_key" },
  );
  if (upErr) throw new ServiceError(upErr.message, 500);

  const { error: lErr } = await db
    .from("session_lifts")
    .update({
      status: finished ? "completed" : "missed",
      progression_applied: true,
      finished_at: new Date().toISOString(),
    })
    .eq("id", lift.id)
    .eq("user_id", userId);
  if (lErr) throw new ServiceError(lErr.message, 500);
}

async function openLift(db: Db, userId: string, sessionId: string, liftId: string) {
  const bundle = await getSessionById(db, userId, sessionId);
  if (!bundle) throw new ServiceError("Session not found.", 404);
  if (bundle.session.status !== "in_progress") throw new ServiceError("Session is closed.", 409);
  const lift = bundle.lifts.find((l) => l.id === liftId);
  if (!lift) throw new ServiceError("Lift not found.", 404);
  if (lift.status === "completed" || lift.status === "missed") throw new ServiceError("Lift already resolved.", 409);
  return lift;
}

/** A legal dumbbell load, or an error for a bodyweight lift. */
function legalWeight(lift: SessionBundle["lifts"][number], weight: unknown): number {
  if (lift.exercise.is_bodyweight) throw new ServiceError("Bodyweight lift.", 400);
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) throw new ServiceError("Invalid weight.", 400);
  return snapToLegal(w, "nearest");
}

/** Changes the weight for this lift's remaining sets (any set, any time). */
export async function adjustWeight(db: Db, userId: string, sessionId: string, liftId: string, weight: number): Promise<number> {
  const lift = await openLift(db, userId, sessionId, liftId);
  const w = legalWeight(lift, weight);
  const { error } = await db
    .from("session_sets")
    .update({ prescribed_weight: w })
    .eq("lift_id", lift.id)
    .eq("user_id", userId)
    .eq("kind", "work")
    .eq("result", "pending");
  if (error) throw new ServiceError(error.message, 500);
  return w;
}

export interface LogSetResult {
  set: SetRow;
  liftCompleted: boolean;
}

/**
 * LOG SET: stores the set as done at the reps shown and the weight used
 * (`weight`, when the lifter changed it). The remaining sets follow that weight.
 * The third working set closes the lift and runs the engine.
 */
export async function logSet(db: Db, userId: string, setId: string, weight?: number): Promise<LogSetResult> {
  const { data: setRow, error } = await db.from("session_sets").select("*").eq("id", setId).eq("user_id", userId).maybeSingle();
  if (error) throw new ServiceError(error.message, 500);
  if (!setRow) throw new ServiceError("Set not found.", 404);
  const set = setRow as SetRow;
  const lift = await openLift(db, userId, set.session_id, set.lift_id);

  const shown = num(set.prescribed_weight);
  const used = weight != null && !lift.exercise.is_bodyweight ? legalWeight(lift, weight) : shown;
  if (set.result !== "completed") {
    const { data: updated, error: uErr } = await db
      .from("session_sets")
      .update({
        result: "completed",
        prescribed_weight: used,
        actual_weight: used,
        actual_reps: set.prescribed_reps,
        logged_at: new Date().toISOString(),
      })
      .eq("id", set.id)
      .select("*")
      .single();
    if (uErr) throw new ServiceError(uErr.message, 500);
    Object.assign(set, updated);
    if (set.kind === "work" && used !== shown) {
      await db
        .from("session_sets")
        .update({ prescribed_weight: used })
        .eq("lift_id", lift.id)
        .eq("kind", "work")
        .eq("result", "pending");
    }
  }
  if (lift.status === "pending") {
    await db.from("session_lifts").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", lift.id);
  }

  const sets = lift.sets.map((s) => (s.id === set.id ? { ...s, result: "completed" as const, actual_weight: used } : s));
  if (liftResultFromSets(sets) === "hit") {
    const weights = sets
      .filter((s) => s.kind === "work")
      .sort((a, b) => a.set_number - b.set_number)
      .map((s) => num(s.actual_weight ?? s.prescribed_weight));
    const settled = lift.exercise.is_bodyweight ? { weight: 0, result: "hit" as const } : settleLift(weights);
    await resolveLift(db, userId, lift, settled.result, settled.weight);
    return { set, liftCompleted: true };
  }
  return { set, liftCompleted: false };
}

/** The lifter left before three LOG SETs: the lift is a miss (hold once, then deload). */
export async function leaveLift(db: Db, userId: string, sessionId: string, liftId: string): Promise<void> {
  const bundle = await getSessionById(db, userId, sessionId);
  const lift = bundle?.lifts.find((l) => l.id === liftId);
  if (!lift) throw new ServiceError("Lift not found.", 404);
  if (lift.status === "completed" || lift.status === "missed") return;
  const weight = liftWeightSoFar(lift);
  await db
    .from("session_sets")
    .update({ result: "missed" })
    .eq("lift_id", lift.id)
    .eq("kind", "work")
    .eq("result", "pending");
  await resolveLift(db, userId, lift, "miss", weight);
}

/** Marks a warm-up set done (never touches the engine). */
export async function logWarmup(db: Db, userId: string, setId: string): Promise<void> {
  const { error } = await db
    .from("session_sets")
    .update({ result: "completed", logged_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("user_id", userId)
    .eq("kind", "warmup");
  if (error) throw new ServiceError(error.message, 500);
}

/** Closes the day once every lift is completed or missed. Assigns the lifetime workout number. */
export async function completeSession(db: Db, userId: string, sessionId: string): Promise<SessionRow> {
  const bundle = await getSessionById(db, userId, sessionId);
  if (!bundle) throw new ServiceError("Session not found.", 404);
  if (bundle.session.status === "complete") return bundle.session;
  for (const lift of bundle.lifts) {
    if (lift.status === "in_progress") await resolveLift(db, userId, lift, "miss", liftWeightSoFar(lift));
    else if (lift.status === "pending") {
      await db.from("session_lifts").update({ status: "missed", finished_at: new Date().toISOString() }).eq("id", lift.id);
    }
  }
  let dayNumber = bundle.session.day_number;
  if (!dayNumber) {
    const { count } = await db
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "complete");
    dayNumber = (count ?? 0) + 1;
  }
  const { data, error } = await db
    .from("sessions")
    .update({ status: "complete", day_number: dayNumber, completed_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new ServiceError(error.message, 500);
  return data as SessionRow;
}

/** The lifter skipped the rest after this set (allowed, discouraged, recorded). */
export async function skipRest(db: Db, userId: string, setId: string): Promise<void> {
  const { error } = await db.from("session_sets").update({ rest_skipped: true }).eq("id", setId).eq("user_id", userId);
  if (error) throw new ServiceError(error.message, 500);
}

/** Wipes every session, set and lift state; restarts at Day 1 with fresh starting loads. */
export async function resetProgress(db: Db, userId: string): Promise<void> {
  const { error } = await db.rpc("reset_own_progress");
  if (error) throw new ServiceError(error.message, 500);
  const profile = await getProfile(db, userId);
  if (profile?.activity_level) await ensureExerciseStates(db, userId, profile.activity_level, profile.weight_lb);
}

// ---------------------------------------------------------------- history

export async function completedDates(db: Db, userId: string, fromYmd: string, toYmd: string): Promise<{ date: string; dayNumber: number | null }[]> {
  const { data, error } = await db
    .from("sessions")
    .select("session_date, day_number")
    .eq("user_id", userId)
    .eq("status", "complete")
    .gte("session_date", fromYmd)
    .lte("session_date", toYmd);
  if (error) throw new ServiceError(error.message, 500);
  return ((data ?? []) as { session_date: string; day_number: number | null }[]).map((r) => ({ date: r.session_date, dayNumber: r.day_number }));
}

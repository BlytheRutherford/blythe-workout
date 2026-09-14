import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyResult,
  displayName,
  EXERCISE_KEYS,
  exerciseByKey,
  liftResultFromSets,
  snapToLegal,
  startingState,
  warmupSets,
  type ActivityLevel,
  type ExerciseSpec,
  type ExerciseState,
} from "@/lib/engine";
import { type LocalDay, ymdToDate } from "./dates";
import type {
  ClipRow,
  ExerciseRow,
  LiftRow,
  ProfileRow,
  SessionBundle,
  SessionRow,
  SetRow,
  StateRow,
} from "./types";

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
    note: row.note,
  };
}

function toSpec(ex: ExerciseRow): ExerciseSpec {
  return { key: ex.exercise_key, rangeMin: ex.range_min, rangeMax: ex.range_max, isBodyweight: ex.is_bodyweight };
}

// ---------------------------------------------------------------- profile

export async function getProfile(db: Db, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  if (error) throw new ServiceError(error.message, 500);
  return (data as ProfileRow | null) ?? null;
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
  const rows = EXERCISE_KEYS.filter((k) => !have.has(k)).map((key) => {
    const def = exerciseByKey(key)!;
    const s = startingState(def, activity, bodyweightLb);
    return {
      user_id: userId,
      exercise_key: key,
      working_weight: s.weight,
      target_reps: s.targetReps,
      consecutive_hits: 0,
      consecutive_misses: 0,
      note: null,
    };
  });
  if (rows.length === 0) return;
  const { error: insErr } = await db.from("user_exercise_state").insert(rows);
  if (insErr) throw new ServiceError(insErr.message, 500);
}

/** Re-derive every starting load from a (new) activity level. Only during calibration. */
export async function resetExerciseStates(db: Db, userId: string, activity: ActivityLevel, bodyweightLb: number | null) {
  const rows = EXERCISE_KEYS.map((key) => {
    const def = exerciseByKey(key)!;
    const s = startingState(def, activity, bodyweightLb);
    return {
      user_id: userId,
      exercise_key: key,
      working_weight: s.weight,
      target_reps: s.targetReps,
      consecutive_hits: 0,
      consecutive_misses: 0,
      note: null,
    };
  });
  const { error } = await db.from("user_exercise_state").upsert(rows, { onConflict: "user_id,exercise_key" });
  if (error) throw new ServiceError(error.message, 500);
}

// ---------------------------------------------------------------- sessions

async function loadBundle(db: Db, session: SessionRow): Promise<SessionBundle> {
  const [{ data: lifts, error: lErr }, { data: sets, error: sErr }, { data: exercises, error: eErr }, { data: forms }] =
    await Promise.all([
      db.from("session_lifts").select("*").eq("session_id", session.id).order("order_index"),
      db.from("session_sets").select("*").eq("session_id", session.id).order("kind").order("set_number"),
      db.from("exercises").select("*").eq("slot_day", session.day_index),
      db.from("form_videos").select("exercise_key, storage_path"),
    ]);
  if (lErr) throw new ServiceError(lErr.message, 500);
  if (sErr) throw new ServiceError(sErr.message, 500);
  if (eErr) throw new ServiceError(eErr.message, 500);
  const exById = new Map<number, ExerciseRow>((exercises as ExerciseRow[]).map((e) => [e.id, e]));
  const formByKey = new Map<string, string>(
    ((forms ?? []) as { exercise_key: string; storage_path: string }[]).map((f) => [f.exercise_key, f.storage_path]),
  );
  const setsByLift = new Map<string, SetRow[]>();
  for (const s of (sets ?? []) as SetRow[]) {
    const arr = setsByLift.get(s.lift_id) ?? [];
    arr.push(s);
    setsByLift.set(s.lift_id, arr);
  }
  const order = { warmup: 0, work: 1 } as const;
  return {
    session,
    lifts: ((lifts ?? []) as (LiftRow & { last_weight: number | null; last_reps: number | null })[]).map((l) => ({
      ...l,
      prescribed_weight: num(l.prescribed_weight),
      sets: (setsByLift.get(l.id) ?? []).sort((a, b) => order[a.kind] - order[b.kind] || a.set_number - b.set_number),
      exercise: exById.get(l.exercise_id)!,
      lastLog: l.last_weight != null && l.last_reps != null ? { weight: num(l.last_weight), reps: l.last_reps } : null,
      formVideoPath: formByKey.get(l.exercise_key) ?? null,
    })),
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
      if (lift.status === "in_progress") {
        await resolveLift(db, userId, lift, lift.exercise, "miss");
      }
    }
    await db.from("sessions").update({ status: "abandoned" }).eq("id", s.id);
  }
}

/** Creates today's session (prescriptions + sets) if it doesn't exist. */
export async function startSession(db: Db, userId: string, day: LocalDay): Promise<SessionBundle> {
  if (day.dayIndex === 0) throw new ServiceError("No lift prescribed today.", 400);
  await finalizeStaleSessions(db, userId, day.ymd);

  const existing = await getSessionForDate(db, userId, day.ymd);
  if (existing) return existing;

  const profile = await getProfile(db, userId);
  if (!profile) throw new ServiceError("Profile missing.", 500);
  await ensureExerciseStates(db, userId, profile.activity_level ?? "moderately_active", profile.weight_lb);

  const [{ data: exercises, error: eErr }, { data: states, error: sErr }] = await Promise.all([
    db.from("exercises").select("*").eq("slot_day", day.dayIndex).order("order_index"),
    db.from("user_exercise_state").select("*").eq("user_id", userId),
  ]);
  if (eErr) throw new ServiceError(eErr.message, 500);
  if (sErr) throw new ServiceError(sErr.message, 500);
  const stateByKey = new Map<string, StateRow>((states as StateRow[]).map((s) => [s.exercise_key, s]));

  // Lifetime day number is fixed when the day starts so per-lift emails can say "Day N".
  const { count: doneCount } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "complete");
  const { data: sessionRow, error: insErr } = await db
    .from("sessions")
    .insert({ user_id: userId, session_date: day.ymd, day_index: day.dayIndex, status: "in_progress", day_number: (doneCount ?? 0) + 1 })
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
    const weight = ex.is_bodyweight ? 0 : snapToLegal(num(st?.working_weight ?? ex.seed_weight), "up");
    const reps = st?.target_reps ?? ex.seed_reps;
    return {
      session_id: session.id,
      user_id: userId,
      exercise_id: ex.id,
      exercise_key: ex.exercise_key,
      display_name: displayName({ name: ex.name, variantRule: ex.variant_rule as "thu-press" | undefined }, date),
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
    const ex = (exercises as ExerciseRow[]).find((e) => e.id === lift.exercise_id)!;
    if (lift.order_index === 1) {
      warmupSets(num(lift.prescribed_weight), lift.prescribed_reps, toSpec(ex)).forEach((w, i) =>
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

/** Applies the engine once per lift and records the outcome. Idempotent. */
async function resolveLift(db: Db, userId: string, lift: LiftRow, exercise: ExerciseRow, result: "hit" | "miss") {
  if (lift.progression_applied) return;
  const { data: stRow, error } = await db
    .from("user_exercise_state")
    .select("*")
    .eq("user_id", userId)
    .eq("exercise_key", lift.exercise_key)
    .maybeSingle();
  if (error) throw new ServiceError(error.message, 500);

  const spec = toSpec(exercise);
  // The state at the time of the lift is what was prescribed today.
  const current: ExerciseState = stRow
    ? { ...toState(stRow as StateRow), weight: num(lift.prescribed_weight), targetReps: lift.prescribed_reps }
    : { weight: num(lift.prescribed_weight), targetReps: lift.prescribed_reps, consecutiveHits: 0, consecutiveMisses: 0, note: null };
  const next = applyResult(current, spec, result);

  const { error: upErr } = await db.from("user_exercise_state").upsert(
    {
      user_id: userId,
      exercise_key: lift.exercise_key,
      working_weight: next.weight,
      target_reps: next.targetReps,
      consecutive_hits: next.consecutiveHits,
      consecutive_misses: next.consecutiveMisses,
      note: next.note,
      last_hit_weight: result === "hit" ? num(lift.prescribed_weight) : (stRow?.last_hit_weight ?? null),
      last_hit_reps: result === "hit" ? lift.prescribed_reps : (stRow?.last_hit_reps ?? null),
      last_logged_at: new Date().toISOString(),
    },
    { onConflict: "user_id,exercise_key" },
  );
  if (upErr) throw new ServiceError(upErr.message, 500);

  const { error: lErr } = await db
    .from("session_lifts")
    .update({
      status: result === "hit" ? "completed" : "missed",
      progression_applied: true,
      finished_at: new Date().toISOString(),
    })
    .eq("id", lift.id)
    .eq("user_id", userId);
  if (lErr) throw new ServiceError(lErr.message, 500);
}

export interface LogSetResult {
  set: SetRow;
  liftCompleted: boolean;
}

/** LOG SET: stores the shown prescription as a hit. Third work set closes the lift and runs the engine. */
export async function logSet(db: Db, userId: string, setId: string, hasClip = false): Promise<LogSetResult> {
  const { data: setRow, error } = await db.from("session_sets").select("*").eq("id", setId).eq("user_id", userId).maybeSingle();
  if (error) throw new ServiceError(error.message, 500);
  if (!setRow) throw new ServiceError("Set not found.", 404);
  const set = setRow as SetRow;

  const bundle = await getSessionById(db, userId, set.session_id);
  if (!bundle) throw new ServiceError("Session not found.", 404);
  if (bundle.session.status !== "in_progress") throw new ServiceError("Session is closed.", 409);
  const lift = bundle.lifts.find((l) => l.id === set.lift_id);
  if (!lift) throw new ServiceError("Lift not found.", 404);
  if (lift.status === "completed" || lift.status === "missed") throw new ServiceError("Lift already resolved.", 409);

  if (set.result !== "completed") {
    const { data: updated, error: uErr } = await db
      .from("session_sets")
      .update({
        result: "completed",
        actual_weight: set.prescribed_weight,
        actual_reps: set.prescribed_reps,
        logged_at: new Date().toISOString(),
        has_clip: hasClip,
      })
      .eq("id", set.id)
      .select("*")
      .single();
    if (uErr) throw new ServiceError(uErr.message, 500);
    Object.assign(set, updated);
  }
  if (lift.status === "pending") {
    await db.from("session_lifts").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", lift.id);
  }

  const sets = lift.sets.map((s) => (s.id === set.id ? { ...s, result: "completed" as const } : s));
  const outcome = liftResultFromSets(sets);
  if (outcome === "hit") {
    await resolveLift(db, userId, lift, lift.exercise, "hit");
    return { set, liftCompleted: true };
  }
  return { set, liftCompleted: false };
}

/** The lifter left before three LOG SETs: the lift is a miss (hold once, then deload). */
export async function leaveLift(db: Db, userId: string, liftId: string): Promise<void> {
  const { data: liftRow, error } = await db.from("session_lifts").select("*").eq("id", liftId).eq("user_id", userId).maybeSingle();
  if (error) throw new ServiceError(error.message, 500);
  if (!liftRow) throw new ServiceError("Lift not found.", 404);
  const lift = liftRow as LiftRow;
  if (lift.status === "completed" || lift.status === "missed") return;
  const { data: ex } = await db.from("exercises").select("*").eq("id", lift.exercise_id).single();
  await db
    .from("session_sets")
    .update({ result: "missed" })
    .eq("lift_id", lift.id)
    .eq("kind", "work")
    .eq("result", "pending");
  await resolveLift(db, userId, lift, ex as ExerciseRow, "miss");
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

/** Closes the day once every lift is completed or missed. Assigns the lifetime day number. */
export async function completeSession(db: Db, userId: string, sessionId: string): Promise<SessionRow> {
  const bundle = await getSessionById(db, userId, sessionId);
  if (!bundle) throw new ServiceError("Session not found.", 404);
  if (bundle.session.status === "complete") return bundle.session;
  for (const lift of bundle.lifts) {
    if (lift.status === "pending" || lift.status === "in_progress") {
      if (lift.status === "in_progress") await resolveLift(db, userId, lift, lift.exercise, "miss");
      else {
        await db.from("session_lifts").update({ status: "missed", finished_at: new Date().toISOString() }).eq("id", lift.id);
      }
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

/** Calibration only: set a lift's working weight (legal loads) and today's pending prescription. */
export async function setStartingWeight(db: Db, userId: string, exerciseKey: string, weight: number, todayYmd: string) {
  const profile = await getProfile(db, userId);
  if (!profile) throw new ServiceError("Profile missing.", 500);
  if (todayYmd > profile.calibration_ends_on) throw new ServiceError("Calibration window has ended.", 403);
  const def = exerciseByKey(exerciseKey);
  if (!def) throw new ServiceError("Unknown lift.", 404);
  if (def.isBodyweight) throw new ServiceError("Bodyweight lift.", 400);
  const legal = snapToLegal(weight, "nearest");
  const { error } = await db
    .from("user_exercise_state")
    .upsert(
      { user_id: userId, exercise_key: exerciseKey, working_weight: legal, target_reps: def.seedReps, consecutive_hits: 0, consecutive_misses: 0, note: null },
      { onConflict: "user_id,exercise_key" },
    );
  if (error) throw new ServiceError(error.message, 500);
  // Today's untouched lift + its pending sets follow the new load.
  const { data: lifts } = await db
    .from("session_lifts")
    .select("id, status, session_id, sessions!inner(session_date)")
    .eq("user_id", userId)
    .eq("exercise_key", exerciseKey)
    .eq("status", "pending")
    .eq("sessions.session_date", todayYmd);
  for (const l of (lifts ?? []) as { id: string }[]) {
    await db.from("session_lifts").update({ prescribed_weight: legal, prescribed_reps: def.seedReps }).eq("id", l.id);
    await db
      .from("session_sets")
      .update({ prescribed_weight: legal, prescribed_reps: def.seedReps })
      .eq("lift_id", l.id)
      .eq("kind", "work");
    const ws = warmupSets(legal, def.seedReps, { key: def.key, rangeMin: def.rangeMin, rangeMax: def.rangeMax, isBodyweight: false });
    for (let i = 0; i < ws.length; i++) {
      await db
        .from("session_sets")
        .update({ prescribed_weight: ws[i].weight, prescribed_reps: ws[i].reps })
        .eq("lift_id", l.id)
        .eq("kind", "warmup")
        .eq("set_number", i + 1);
    }
  }
  return legal;
}

/** The lifter skipped the rest after this set (allowed, discouraged, recorded). */
export async function skipRest(db: Db, userId: string, setId: string): Promise<void> {
  const { error } = await db.from("session_sets").update({ rest_skipped: true }).eq("id", setId).eq("user_id", userId);
  if (error) throw new ServiceError(error.message, 500);
}

/** Wipes every session, set, clip and lift state; restarts at Day 1 with fresh starting loads. */
export async function resetProgress(db: Db, userId: string): Promise<void> {
  const { error } = await db.rpc("reset_own_progress");
  if (error) throw new ServiceError(error.message, 500);
  const profile = await getProfile(db, userId);
  if (profile?.activity_level) await ensureExerciseStates(db, userId, profile.activity_level, profile.weight_lb);
}

// ---------------------------------------------------------------- clips

export async function recordClip(
  db: Db,
  userId: string,
  input: { sessionId: string; liftId: string; setNumber: number; storagePath: string; mime: string; bytes: number; durationMs: number; trimmedMs: number },
): Promise<ClipRow> {
  const { data: lift } = await db.from("session_lifts").select("exercise_key").eq("id", input.liftId).eq("user_id", userId).maybeSingle();
  if (!lift) throw new ServiceError("Lift not found.", 404);
  const { data, error } = await db
    .from("clips")
    .upsert(
      {
        session_id: input.sessionId,
        lift_id: input.liftId,
        user_id: userId,
        exercise_key: (lift as { exercise_key: string }).exercise_key,
        set_number: input.setNumber,
        storage_path: input.storagePath,
        mime: input.mime,
        bytes: input.bytes,
        duration_ms: input.durationMs,
        trimmed_ms: input.trimmedMs,
      },
      { onConflict: "lift_id,set_number" },
    )
    .select("*")
    .single();
  if (error) throw new ServiceError(error.message, 500);
  return data as ClipRow;
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

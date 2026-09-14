import { MAX_LOAD, nextJumpPercent, nextLegal, prevLegal, snapToLegal } from "./loads";

/** What the engine needs to know about a lift. */
export interface ExerciseSpec {
  key: string;
  rangeMin: number;
  rangeMax: number;
  isBodyweight: boolean;
}

/** Per-user, per-lift progression state. */
export interface ExerciseState {
  /** lb per dumbbell; 0 for bodyweight lifts */
  weight: number;
  targetReps: number;
  consecutiveHits: number;
  consecutiveMisses: number;
  /** Short whisper shown under the hero number, e.g. "Dumbbell max. Adding reps." */
  note: string | null;
}

export type LiftResult = "hit" | "miss";

/** Bonus reps allowed past the range ceiling once load can no longer go up. */
export const HARD_CAP_BONUS = 8;

export const NOTE_DUMBBELL_MAX = "Dumbbell max. Adding reps.";
export const NOTE_BODYWEIGHT = "Bodyweight. Adding reps.";
export const NOTE_REP_CAP = "Rep cap. Slow the tempo.";
export const NOTE_DELOAD = "Deloaded. Reps reset.";
export const NOTE_HOLD = "Held. Same prescription once more.";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Rep ceiling for the *current* weight.
 *
 * Adjustable dumbbells jump 5–50 % per step, not the 2–10 % the classic
 * 8–12 double progression assumes. A 25→30 lb step (+20 %) costs ~5 reps, so a
 * lifter who just graduated at 25 × 12 lands at 30 × ~7 — below the floor —
 * and would be marked as failing. The ceiling therefore rises with the size of
 * the next jump so that the graduation lands at roughly equal difficulty:
 *
 *   ceiling = clamp(rangeMin + round(jump% / 2.5), rangeMax, rangeMax + 8)
 *
 * 45→50 (11 %) → 12 · 25→30 (20 %) → 16 · 10→12.5 (25 %) → 18 · 7.5→10 (33 %) → 20.
 * Bodyweight lifts and the 52.5 cap use the plain range ceiling; bonus reps
 * beyond it are handled in applyResult.
 */
export function effectiveCeiling(weight: number, spec: ExerciseSpec): number {
  if (spec.isBodyweight || weight >= MAX_LOAD) return spec.rangeMax;
  const jump = nextJumpPercent(weight);
  const adaptive = spec.rangeMin + Math.round(jump / 2.5);
  return clamp(adaptive, spec.rangeMax, spec.rangeMax + HARD_CAP_BONUS);
}

/** Absolute most reps the engine will ever prescribe for a lift. */
export function hardCap(spec: ExerciseSpec): number {
  return spec.rangeMax + HARD_CAP_BONUS;
}

/**
 * Apply one lift result and return the next prescription.
 *
 * hit  = all three working sets logged at the shown prescription.
 * miss = the lift was started but the lifter left before three LOG SETs.
 *
 * Rules (spec + evidence):
 *  - hit, reps < ceiling            → same weight, +1 rep
 *  - hit, reps at ceiling           → next legal load, reps → rangeMin
 *  - hit at 52.5 / bodyweight cap   → stay, +1 bonus rep (up to hardCap), note
 *  - miss                           → hold once (identical prescription)
 *  - second straight miss           → one legal increment down, reps → rangeMin
 *  - a prescription is therefore never issued a third time without
 *    graduating or deloading.
 */
export function applyResult(state: ExerciseState, spec: ExerciseSpec, result: LiftResult): ExerciseState {
  const weight = spec.isBodyweight ? 0 : snapToLegal(state.weight, "up");
  const reps = Math.max(spec.rangeMin, Math.round(state.targetReps));

  if (result === "miss") {
    const misses = state.consecutiveMisses + 1;
    if (misses >= 2) {
      return {
        weight: spec.isBodyweight ? 0 : prevLegal(weight),
        targetReps: spec.rangeMin,
        consecutiveHits: 0,
        consecutiveMisses: 0,
        note: NOTE_DELOAD,
      };
    }
    return { weight, targetReps: reps, consecutiveHits: 0, consecutiveMisses: misses, note: NOTE_HOLD };
  }

  // hit
  const hits = state.consecutiveHits + 1;
  const ceiling = effectiveCeiling(weight, spec);
  const cap = hardCap(spec);

  if (reps < ceiling) {
    return { weight, targetReps: reps + 1, consecutiveHits: hits, consecutiveMisses: 0, note: null };
  }

  if (spec.isBodyweight) {
    if (reps < cap) {
      return { weight: 0, targetReps: reps + 1, consecutiveHits: hits, consecutiveMisses: 0, note: NOTE_BODYWEIGHT };
    }
    return { weight: 0, targetReps: cap, consecutiveHits: hits, consecutiveMisses: 0, note: NOTE_REP_CAP };
  }

  if (weight >= MAX_LOAD) {
    if (reps < cap) {
      return { weight: MAX_LOAD, targetReps: reps + 1, consecutiveHits: hits, consecutiveMisses: 0, note: NOTE_DUMBBELL_MAX };
    }
    return { weight: MAX_LOAD, targetReps: cap, consecutiveHits: hits, consecutiveMisses: 0, note: NOTE_REP_CAP };
  }

  return {
    weight: nextLegal(weight),
    targetReps: spec.rangeMin,
    consecutiveHits: hits,
    consecutiveMisses: 0,
    note: null,
  };
}

export interface WarmupSet {
  weight: number;
  reps: number;
}

/**
 * Warm-up sets for the first lift of the day only.
 * Loaded: ~50 % × 5 then ~75 % × 3 (snapped to legal loads, min 5 lb,
 * never equal to the working weight). Bodyweight: one half-rep-count set.
 * Warm-ups are never counted by the engine.
 */
export function warmupSets(weight: number, reps: number, spec: ExerciseSpec): WarmupSet[] {
  if (spec.isBodyweight || weight <= 0) {
    return [{ weight: 0, reps: Math.max(3, Math.ceil(reps / 2)) }];
  }
  const w1 = snapToLegal(weight * 0.5, "nearest");
  const w2 = snapToLegal(weight * 0.75, "nearest");
  const sets: WarmupSet[] = [];
  if (w1 < weight) sets.push({ weight: w1, reps: 5 });
  if (w2 < weight && w2 !== w1) sets.push({ weight: w2, reps: 3 });
  if (sets.length === 0) sets.push({ weight: 5, reps: 5 });
  return sets;
}

/** Lift result from the day's set rows. Warm-up sets are ignored. */
export function liftResultFromSets(
  sets: { kind: "warmup" | "work"; result: "pending" | "completed" | "missed" }[],
): LiftResult | "not_started" {
  const work = sets.filter((s) => s.kind === "work");
  if (work.length === 0) return "not_started";
  if (work.every((s) => s.result === "completed")) return "hit";
  if (work.every((s) => s.result === "pending")) return "not_started";
  return "miss";
}

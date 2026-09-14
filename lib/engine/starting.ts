import { MIN_LOAD, snapToLegal } from "./loads";
import type { ActivityLevel, ExerciseDef } from "./program";
import type { ExerciseState } from "./progression";

/**
 * Starting-load multipliers applied to the trained ("Blythe") seed.
 * Anchored on ACSM's novice prescription of 60–70 % 1RM for 8–12 reps; the
 * 14-day calibration window corrects the rest.
 */
export const MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 0.45,
  lightly_active: 0.55,
  moderately_active: 0.7,
  returning_lifter: 0.85,
  trained: 1.0,
};

/** Bodyweight the seed loads were written for. Returning lifters scale by this. */
export const REFERENCE_BODYWEIGHT_LB = 160;

/** Nobody starts a lift above this unless they are "trained". */
export const NON_TRAINED_CAP_LB = 40;

/**
 * Starting prescription for one lift.
 * Returning lifters ≈ seed × 0.85 × (bodyweight / 160), clamped to ±20 %.
 * Everything is snapped DOWN to a legal load (conservative), min 5 lb,
 * capped at 40 lb unless trained.
 */
export function startingState(
  def: Pick<ExerciseDef, "seedWeight" | "seedReps" | "isBodyweight" | "rangeMin">,
  activity: ActivityLevel,
  bodyweightLb?: number | null,
): ExerciseState {
  const reps = Math.max(def.rangeMin, def.seedReps);
  if (def.isBodyweight) {
    return { weight: 0, targetReps: reps, consecutiveHits: 0, consecutiveMisses: 0, note: null };
  }
  let w = def.seedWeight * MULTIPLIERS[activity];
  if (activity === "returning_lifter" && bodyweightLb && bodyweightLb > 0) {
    const scale = Math.max(0.8, Math.min(1.2, bodyweightLb / REFERENCE_BODYWEIGHT_LB));
    w *= scale;
  }
  if (activity !== "trained") w = Math.min(w, NON_TRAINED_CAP_LB);
  const weight = Math.max(MIN_LOAD, snapToLegal(w, "down"));
  return { weight, targetReps: reps, consecutiveHits: 0, consecutiveMisses: 0, note: null };
}

/** Days after signup during which "Change starting weight" is available. */
export const CALIBRATION_DAYS = 14;

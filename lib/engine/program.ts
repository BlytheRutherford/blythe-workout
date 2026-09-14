/**
 * The Blythe Workout program — single source of truth.
 *
 * Every user runs the same five days. Only starting loads differ.
 * The SQL seed (supabase/seed.sql) is generated from this file by
 * `npm run gen:seed`, so edit here, never in SQL.
 *
 * Evidence notes (see README "Program evidence"):
 *  - rest: 120 s on the day's two heaviest compounds, 90 s other compounds,
 *    75 s unilateral / hanging / isolation, 60 s core (Singer 2024; Grgic 2017).
 *  - rep range 8–12 default, calves 10–15 standing / 12–20 seated (soleus).
 *  - loaded Russian twist replaced by a half-kneeling anti-rotation press-out
 *    (McGill: train flexion moment, not loaded flexion + rotation).
 *  - skull crusher replaced by seated two-hand overhead DB extension
 *    (Maeo 2023: overhead position grows all three heads more).
 *  - bench back extension (unanchorable on a flat bench) replaced by DB hip thrust.
 *  - Friday anti-rotation slot becomes a second DB RDL so hamstrings/glutes
 *    are trained twice a week (ACSM 2026: ≥2 sessions/muscle/week).
 */

export type Category = "compound" | "unilateral" | "hanging" | "isolation" | "core";

export type ActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "moderately_active"
  | "returning_lifter"
  | "trained";

export const ACTIVITY_LEVELS: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Sedentary" },
  { value: "lightly_active", label: "Lightly active" },
  { value: "moderately_active", label: "Moderately active" },
  { value: "returning_lifter", label: "Returning lifter" },
  { value: "trained", label: "Trained" },
];

export interface ExerciseDef {
  /** Unique per slot (day + position). */
  slug: string;
  /** Progression key. Lifts that appear on two days share one key. */
  key: string;
  name: string;
  /** 1 = Monday … 5 = Friday */
  slotDay: 1 | 2 | 3 | 4 | 5;
  orderIndex: 1 | 2 | 3 | 4 | 5;
  restSeconds: number;
  rangeMin: number;
  rangeMax: number;
  isUnilateral: boolean;
  isBodyweight: boolean;
  category: Category;
  /** Trained ("Blythe") seed load per dumbbell, lb. 0 for bodyweight. */
  seedWeight: number;
  seedReps: number;
  /** Optional per-slot display rule. */
  variantRule?: "thu-press";
  /** Unit shown after reps, e.g. "/side" or " breaths/side". */
  repUnit?: string;
  /** Long-form name for email subjects, e.g. "Dumbbell incline press". */
  emailName: string;
}

export interface DayDef {
  day: 1 | 2 | 3 | 4 | 5;
  short: "MON" | "TUE" | "WED" | "THU" | "FRI";
  name: string;
}

export const DAYS: DayDef[] = [
  { day: 1, short: "MON", name: "CHEST + CORE" },
  { day: 2, short: "TUE", name: "BACK + CORE" },
  { day: 3, short: "WED", name: "LEGS + POSTERIOR + CALVES" },
  { day: 4, short: "THU", name: "CHEST + SHOULDERS + ARMS" },
  { day: 5, short: "FRI", name: "BACK + POSTERIOR + CALVES" },
];

export const EXERCISES: ExerciseDef[] = [
  // ---------------- Monday — Chest + Core
  { slug: "mon-incline-db-press", key: "incline-db-press", name: "Incline DB press", slotDay: 1, orderIndex: 1, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 40, seedReps: 8, emailName: "Dumbbell incline press" },
  { slug: "mon-flat-db-press", key: "flat-db-press", name: "Flat DB press", slotDay: 1, orderIndex: 2, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 35, seedReps: 8, emailName: "Dumbbell flat press" },
  { slug: "mon-db-pullover", key: "db-pullover", name: "DB pullover", slotDay: 1, orderIndex: 3, restSeconds: 75, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "isolation", seedWeight: 25, seedReps: 8, emailName: "Dumbbell pullover" },
  { slug: "mon-hanging-knee-raise", key: "hanging-knee-raise", name: "Hanging knee raise", slotDay: 1, orderIndex: 4, restSeconds: 75, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: true, category: "hanging", seedWeight: 0, seedReps: 8, emailName: "Hanging knee raise" },
  { slug: "mon-anti-rotation-press", key: "anti-rotation-press", name: "Half-kneeling anti-rotation press", slotDay: 1, orderIndex: 5, restSeconds: 60, rangeMin: 8, rangeMax: 12, isUnilateral: true, isBodyweight: false, category: "core", seedWeight: 20, seedReps: 8, repUnit: " breaths/side", emailName: "Half-kneeling anti-rotation press" },

  // ---------------- Tuesday — Back + Core
  { slug: "tue-pull-up", key: "pull-up", name: "Pull-up", slotDay: 2, orderIndex: 1, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: true, category: "compound", seedWeight: 0, seedReps: 8, emailName: "Pull-up" },
  { slug: "tue-single-arm-db-row", key: "single-arm-db-row", name: "Single-arm DB row", slotDay: 2, orderIndex: 2, restSeconds: 90, rangeMin: 8, rangeMax: 12, isUnilateral: true, isBodyweight: false, category: "unilateral", seedWeight: 30, seedReps: 8, repUnit: "/side", emailName: "Single-arm dumbbell row" },
  { slug: "tue-chest-supported-db-row", key: "chest-supported-db-row", name: "Chest-supported DB row", slotDay: 2, orderIndex: 3, restSeconds: 90, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 25, seedReps: 8, emailName: "Chest-supported dumbbell row" },
  { slug: "tue-rear-delt-fly", key: "rear-delt-fly", name: "Rear-delt fly", slotDay: 2, orderIndex: 4, restSeconds: 75, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "isolation", seedWeight: 10, seedReps: 8, emailName: "Rear-delt fly" },
  { slug: "tue-dead-bug", key: "dead-bug", name: "Dead bug", slotDay: 2, orderIndex: 5, restSeconds: 60, rangeMin: 8, rangeMax: 12, isUnilateral: true, isBodyweight: true, category: "core", seedWeight: 0, seedReps: 8, repUnit: "/side", emailName: "Dead bug" },

  // ---------------- Wednesday — Legs / posterior / calves
  { slug: "wed-goblet-squat", key: "goblet-squat", name: "Goblet squat", slotDay: 3, orderIndex: 1, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 30, seedReps: 8, emailName: "Goblet squat" },
  { slug: "wed-db-rdl", key: "db-rdl", name: "DB RDL", slotDay: 3, orderIndex: 2, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 30, seedReps: 8, emailName: "Dumbbell Romanian deadlift" },
  { slug: "wed-reverse-lunge", key: "reverse-lunge", name: "Reverse lunge", slotDay: 3, orderIndex: 3, restSeconds: 75, rangeMin: 8, rangeMax: 12, isUnilateral: true, isBodyweight: false, category: "unilateral", seedWeight: 20, seedReps: 8, repUnit: "/side", emailName: "Reverse lunge" },
  { slug: "wed-single-leg-calf-raise", key: "single-leg-calf-raise", name: "Single-leg calf raise", slotDay: 3, orderIndex: 4, restSeconds: 60, rangeMin: 10, rangeMax: 15, isUnilateral: true, isBodyweight: false, category: "isolation", seedWeight: 20, seedReps: 10, repUnit: "/side", emailName: "Single-leg calf raise" },
  { slug: "wed-db-hip-thrust", key: "db-hip-thrust", name: "DB hip thrust", slotDay: 3, orderIndex: 5, restSeconds: 75, rangeMin: 10, rangeMax: 15, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 30, seedReps: 10, emailName: "Dumbbell hip thrust" },

  // ---------------- Thursday — Chest / shoulders / arms
  { slug: "thu-press", key: "thu-press", name: "Decline DB press", slotDay: 4, orderIndex: 1, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 35, seedReps: 8, variantRule: "thu-press", emailName: "Dumbbell decline press" },
  { slug: "thu-seated-db-oh-press", key: "seated-db-oh-press", name: "Seated DB overhead press", slotDay: 4, orderIndex: 2, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 30, seedReps: 8, emailName: "Seated dumbbell overhead press" },
  { slug: "thu-overhead-db-extension", key: "overhead-db-extension", name: "Overhead DB extension", slotDay: 4, orderIndex: 3, restSeconds: 75, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "isolation", seedWeight: 25, seedReps: 8, emailName: "Overhead dumbbell extension" },
  { slug: "thu-hammer-curl", key: "hammer-curl", name: "Hammer curl", slotDay: 4, orderIndex: 4, restSeconds: 75, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "isolation", seedWeight: 20, seedReps: 8, emailName: "Hammer curl" },
  { slug: "thu-lateral-raise", key: "lateral-raise", name: "Lateral raise", slotDay: 4, orderIndex: 5, restSeconds: 75, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "isolation", seedWeight: 7.5, seedReps: 8, emailName: "Lateral raise" },

  // ---------------- Friday — Back / posterior / calves
  { slug: "fri-pull-up", key: "pull-up", name: "Pull-up", slotDay: 5, orderIndex: 1, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: true, category: "compound", seedWeight: 0, seedReps: 8, emailName: "Pull-up" },
  { slug: "fri-bent-over-row", key: "bent-over-row", name: "Two-arm bent-over row", slotDay: 5, orderIndex: 2, restSeconds: 120, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 25, seedReps: 8, emailName: "Two-arm bent-over dumbbell row" },
  { slug: "fri-db-rdl", key: "db-rdl", name: "DB RDL", slotDay: 5, orderIndex: 3, restSeconds: 90, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: false, category: "compound", seedWeight: 30, seedReps: 8, emailName: "Dumbbell Romanian deadlift" },
  { slug: "fri-hanging-leg-raise", key: "hanging-leg-raise", name: "Hanging leg raise", slotDay: 5, orderIndex: 4, restSeconds: 75, rangeMin: 8, rangeMax: 12, isUnilateral: false, isBodyweight: true, category: "hanging", seedWeight: 0, seedReps: 8, emailName: "Hanging leg raise" },
  { slug: "fri-seated-calf-raise", key: "seated-calf-raise", name: "Seated single-leg calf raise", slotDay: 5, orderIndex: 5, restSeconds: 60, rangeMin: 12, rangeMax: 20, isUnilateral: true, isBodyweight: false, category: "isolation", seedWeight: 20, seedReps: 12, repUnit: "/side", emailName: "Seated single-leg calf raise" },
];

/** Unique progression keys, in first-appearance order. */
export const EXERCISE_KEYS: string[] = Array.from(new Set(EXERCISES.map((e) => e.key)));

export function exercisesForDay(day: number): ExerciseDef[] {
  return EXERCISES.filter((e) => e.slotDay === day).sort((a, b) => a.orderIndex - b.orderIndex);
}

export function exerciseByKey(key: string): ExerciseDef | undefined {
  return EXERCISES.find((e) => e.key === key);
}

/** ISO-8601 week number for a date (local calendar). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Display name for a slot on a given date (Thursday press alternates by ISO week). */
export function displayName(def: Pick<ExerciseDef, "name" | "variantRule">, date: Date): string {
  if (def.variantRule === "thu-press") {
    return isoWeek(date) % 2 === 0 ? "Decline DB press" : "Flat DB press";
  }
  return def.name;
}

/** Long-form name for email subjects ("Day 3: Dumbbell decline press"). */
export function emailName(def: Pick<ExerciseDef, "emailName" | "variantRule">, date: Date): string {
  if (def.variantRule === "thu-press") {
    return isoWeek(date) % 2 === 0 ? "Dumbbell decline press" : "Dumbbell flat press";
  }
  return def.emailName;
}

/** Day index 1–5 for Mon–Fri, 0 for Saturday/Sunday. */
export function dayIndexFor(date: Date): number {
  const dow = date.getDay(); // 0 Sun … 6 Sat
  return dow >= 1 && dow <= 5 ? dow : 0;
}

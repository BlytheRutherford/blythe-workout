/**
 * The Blythe Workout program — single source of truth.
 *
 * Every user runs the same five days. Only starting loads differ.
 * The SQL seed (supabase/seed.sql) is generated from this file by
 * `npm run gen:seed`, so edit here, never in SQL.
 *
 * Evidence notes (see README "Program evidence"):
 *  - 6 lifts × 3 sets ≈ 47–52 min, inside the 45–60 min budget (Remmert 2025
 *    per-session ceiling ≈ 8 direct sets/muscle; Iversen 2021 time modelling).
 *  - 10–20 fractional sets/muscle/week is the productive band (ACSM 2026;
 *    Baz-Valle 2022; Pelland 2025 dose-response).
 *  - Exercises are NOT rotated on a calendar: random variation showed no
 *    benefit over fixed selection (Baz-Valle 2019) and excessive rotation
 *    hurts (Kassiano 2022). Variety comes from breadth inside the week
 *    (Fonseca 2014) and from earned graduation up each lift's variant ladder.
 *  - rest: 120 s on the day's heavy compounds, 90 s other compounds,
 *    75 s unilateral / hanging / isolation, 60 s core (Singer 2024; Grgic 2017).
 *  - loaded Russian twist replaced by a half-kneeling anti-rotation press-out
 *    (McGill: train flexion moment, not loaded flexion + rotation).
 *  - skull crusher replaced by seated overhead DB extension (Maeo 2023).
 *  - both hamstring branches are trained: hip-hinge (RDL) grows the long head,
 *    knee-flexion (Nordic) grows the rest — neither substitutes (Maeo 2024).
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

/**
 * One rung of a lift's ladder. Rung 0 is what a new lifter starts on; the
 * engine promotes to the next rung only when the current one is genuinely
 * finished — top of the rep range at 52.5 lb (or at the bodyweight rep cap).
 * Each rung restarts the load low so double progression can run for months.
 */
export interface Variant {
  name: string;
  /** Long-form name for email subjects: "Day 12: Dumbbell incline press". */
  emailName: string;
  /** Per-dumbbell restart load, lb. 0 = bodyweight. */
  startWeight: number;
  isBodyweight: boolean;
  rangeMin: number;
  rangeMax: number;
  /** Overrides the slot's rep unit when a rung goes unilateral. */
  repUnit?: string;
  /** One line shown under the hero number for the first sessions on a new rung. */
  cue?: string;
}

export interface ExerciseDef {
  /** Unique per slot (day + position). */
  slug: string;
  /** Progression key. Lifts that appear on two days share one key and one ladder. */
  key: string;
  name: string;
  /** 1 = Monday … 5 = Friday */
  slotDay: 1 | 2 | 3 | 4 | 5;
  orderIndex: 1 | 2 | 3 | 4 | 5 | 6;
  restSeconds: number;
  rangeMin: number;
  rangeMax: number;
  isUnilateral: boolean;
  isBodyweight: boolean;
  category: Category;
  /** Trained ("Blythe") seed load per dumbbell, lb. 0 for bodyweight. */
  seedWeight: number;
  seedReps: number;
  /** Optional per-slot display rule (rung 0 only). */
  variantRule?: "thu-press";
  /** Unit shown after reps, e.g. "/side" or " breaths/side". */
  repUnit?: string;
  emailName: string;
}

export interface DayDef {
  day: 1 | 2 | 3 | 4 | 5;
  short: "MON" | "TUE" | "WED" | "THU" | "FRI";
  name: string;
}

export const DAYS: DayDef[] = [
  { day: 1, short: "MON", name: "CHEST + CORE" },
  { day: 2, short: "TUE", name: "BACK + ARMS" },
  { day: 3, short: "WED", name: "LEGS + POSTERIOR" },
  { day: 4, short: "THU", name: "PUSH + ARMS" },
  { day: 5, short: "FRI", name: "BACK + POSTERIOR" },
];

/** Working sets per lift. */
export const WORK_SETS = 3;

/**
 * The ladders, keyed by progression key. Rung 0 must match the slot's base
 * fields (enforced by a test). Later rungs are the evidence-backed answer to
 * "the dumbbells only go to 52.5": convert to unilateral, add range of motion
 * via a deficit, move to a harder mechanical position, or hand the movement to
 * bodyweight where the ceiling is effectively unlimited.
 */
export const VARIANTS: Record<string, Variant[]> = {
  // ---------------- press / chest
  "incline-db-press": [
    { name: "Incline DB press", emailName: "Dumbbell incline press", startWeight: 40, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Incline DB press · 60°", emailName: "Dumbbell incline press at 60 degrees", startWeight: 35, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "Steeper bench. Longer stretch, lighter load." },
    { name: "Single-arm incline press", emailName: "Single-arm dumbbell incline press", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "One arm at a time. Brace hard against the twist." },
    { name: "Archer push-up", emailName: "Archer push-up", startWeight: 0, isBodyweight: true, rangeMin: 6, rangeMax: 12, repUnit: "/side", cue: "Bodyweight from here. One arm does the work." },
  ],
  "flat-db-press": [
    { name: "Flat DB press", emailName: "Dumbbell flat press", startWeight: 35, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Single-arm flat DB press", emailName: "Single-arm dumbbell flat press", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "One arm at a time. Ribs down, hips square." },
    { name: "Deficit DB press", emailName: "Deficit dumbbell flat press", startWeight: 40, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "Dumbbells turned in, elbows below the bench line." },
  ],
  "db-pullover": [
    { name: "DB pullover", emailName: "Dumbbell pullover", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Single-arm DB pullover", emailName: "Single-arm dumbbell pullover", startWeight: 17.5, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Cross-bench pullover", emailName: "Cross-bench dumbbell pullover", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "Shoulders across the bench, hips low. Deeper stretch." },
  ],
  "lateral-raise": [
    { name: "Lateral raise", emailName: "Lateral raise", startWeight: 7.5, isBodyweight: false, rangeMin: 10, rangeMax: 15 },
    { name: "Lean-away lateral raise", emailName: "Lean-away lateral raise", startWeight: 5, isBodyweight: false, rangeMin: 10, rangeMax: 15, repUnit: "/side", cue: "Hold the bench, lean away. Longer lever, harder at the bottom." },
  ],
  "push-up": [
    { name: "Feet-elevated push-up", emailName: "Feet-elevated push-up", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 15 },
    { name: "Deficit feet-elevated push-up", emailName: "Deficit feet-elevated push-up", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 15, cue: "Hands on the dumbbells. Chest below your hands." },
    { name: "Archer push-up", emailName: "Archer push-up", startWeight: 0, isBodyweight: true, rangeMin: 6, rangeMax: 12, repUnit: "/side" },
    { name: "One-arm push-up eccentric", emailName: "One-arm push-up eccentric", startWeight: 0, isBodyweight: true, rangeMin: 5, rangeMax: 10, repUnit: "/side", cue: "Lower on one arm for 4 s, push back with two." },
  ],

  // ---------------- pull / back
  "pull-up": [
    { name: "Pull-up", emailName: "Pull-up", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 12 },
    { name: "Weighted pull-up", emailName: "Weighted pull-up", startWeight: 10, isBodyweight: false, rangeMin: 6, rangeMax: 12, cue: "One dumbbell squeezed between the feet." },
    { name: "Archer pull-up", emailName: "Archer pull-up", startWeight: 0, isBodyweight: true, rangeMin: 5, rangeMax: 10, repUnit: "/side" },
  ],
  "single-arm-db-row": [
    { name: "Single-arm DB row", emailName: "Single-arm dumbbell row", startWeight: 30, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Deficit single-arm row", emailName: "Deficit single-arm dumbbell row", startWeight: 40, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "Knee on the bench, let the weight hang past your shoulder." },
    { name: "Single-arm row + partials", emailName: "Single-arm dumbbell row with lengthened partials", startWeight: 45, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "After the last full rep, add half-reps from the stretch." },
  ],
  "chest-supported-db-row": [
    { name: "Chest-supported DB row", emailName: "Chest-supported dumbbell row", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Single-arm chest-supported row", emailName: "Single-arm chest-supported row", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Chest-supported row + partials", emailName: "Chest-supported row with lengthened partials", startWeight: 35, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "Half-reps from the bottom once the full ones stop." },
  ],
  "bent-over-row": [
    { name: "Two-arm bent-over row", emailName: "Two-arm bent-over dumbbell row", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Deficit bent-over row", emailName: "Deficit bent-over dumbbell row", startWeight: 35, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "Stand on the bench. Full hang at the bottom." },
    { name: "Bent-over row + partials", emailName: "Bent-over row with lengthened partials", startWeight: 45, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
  ],
  "rear-delt-fly": [
    { name: "Rear-delt fly", emailName: "Rear-delt fly", startWeight: 10, isBodyweight: false, rangeMin: 10, rangeMax: 15 },
    { name: "Prone incline rear-delt fly", emailName: "Prone incline rear-delt fly", startWeight: 10, isBodyweight: false, rangeMin: 10, rangeMax: 15, cue: "Face down on the incline bench. No swing available." },
  ],

  // ---------------- arms
  "incline-db-curl": [
    { name: "Incline DB curl", emailName: "Incline dumbbell curl", startWeight: 15, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Single-arm incline curl", emailName: "Single-arm incline dumbbell curl", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Incline curl + partials", emailName: "Incline dumbbell curl with lengthened partials", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
  ],
  "hammer-curl": [
    { name: "Hammer curl", emailName: "Hammer curl", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Incline hammer curl", emailName: "Incline hammer curl", startWeight: 15, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "Arms behind the body. Harder at the bottom." },
    { name: "Single-arm incline hammer curl", emailName: "Single-arm incline hammer curl", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
  ],
  "overhead-db-extension": [
    { name: "Overhead DB extension", emailName: "Overhead dumbbell extension", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Single-arm overhead extension", emailName: "Single-arm overhead dumbbell extension", startWeight: 15, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Feet-elevated bench dip", emailName: "Feet-elevated bench dip", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 15, cue: "Hands on the bench, heels on the mat stack." },
  ],
  "seated-db-oh-press": [
    { name: "Seated DB overhead press", emailName: "Seated dumbbell overhead press", startWeight: 30, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Standing single-arm OH press", emailName: "Standing single-arm overhead press", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "Standing, one arm. The core pays for the other side." },
    { name: "Z-press", emailName: "Seated floor press (Z-press)", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "Sat on the floor, legs straight. No leg drive at all." },
    { name: "Pike push-up", emailName: "Pike push-up", startWeight: 0, isBodyweight: true, rangeMin: 6, rangeMax: 12, cue: "Feet on the bench, hips high." },
  ],
  "thu-press": [
    { name: "Decline DB press", emailName: "Dumbbell decline press", startWeight: 35, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Single-arm decline press", emailName: "Single-arm dumbbell decline press", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Deficit push-up", emailName: "Deficit push-up", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 15, cue: "Hands on the dumbbells, chest to the floor." },
  ],

  // ---------------- legs
  "goblet-squat": [
    { name: "Goblet squat", emailName: "Goblet squat", startWeight: 30, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Heel-elevated goblet squat", emailName: "Heel-elevated goblet squat", startWeight: 35, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "Heels on the mat stack. Deeper knee bend, more quad." },
    { name: "Front-racked squat", emailName: "Front-racked dumbbell squat", startWeight: 30, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "A dumbbell on each shoulder — double the load available." },
    { name: "Heel-elevated front-racked squat", emailName: "Heel-elevated front-racked dumbbell squat", startWeight: 35, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "Sissy squat", emailName: "Sissy squat", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 15, cue: "Hold the bench, knees travel forward, hips stay open." },
  ],
  "rfe-split-squat": [
    { name: "RFE split squat", emailName: "Rear-foot-elevated split squat", startWeight: 15, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Deficit RFE split squat", emailName: "Deficit rear-foot-elevated split squat", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "Front foot on the mat stack. Knee travels further." },
    { name: "Paused deficit RFE split squat", emailName: "Paused deficit rear-foot-elevated split squat", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "Two seconds at the bottom, no bounce." },
  ],
  "reverse-lunge": [
    { name: "Reverse lunge", emailName: "Reverse lunge", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Deficit reverse lunge", emailName: "Deficit reverse lunge", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "Front foot on the mat stack. Back knee drops lower." },
    { name: "Paused deficit reverse lunge", emailName: "Paused deficit reverse lunge", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
  ],
  "db-rdl": [
    { name: "DB RDL", emailName: "Dumbbell Romanian deadlift", startWeight: 30, isBodyweight: false, rangeMin: 8, rangeMax: 12 },
    { name: "B-stance RDL", emailName: "B-stance Romanian deadlift", startWeight: 30, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "Back foot on the toe for balance only. Front leg takes it." },
    { name: "Single-leg RDL", emailName: "Single-leg Romanian deadlift", startWeight: 15, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Deficit single-leg RDL", emailName: "Deficit single-leg Romanian deadlift", startWeight: 12.5, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "Stand on the bench. The dumbbell passes your foot." },
  ],
  "nordic-curl": [
    { name: "Assisted Nordic curl", emailName: "Assisted Nordic curl", startWeight: 0, isBodyweight: true, rangeMin: 5, rangeMax: 10, cue: "Heels under the bench. Lower slowly, catch yourself with your hands." },
    { name: "Eccentric-only Nordic curl", emailName: "Eccentric-only Nordic curl", startWeight: 0, isBodyweight: true, rangeMin: 5, rangeMax: 10, cue: "All the way down under control, push back up with your hands." },
    { name: "Full Nordic curl", emailName: "Nordic curl", startWeight: 0, isBodyweight: true, rangeMin: 5, rangeMax: 10 },
    { name: "Weighted Nordic curl", emailName: "Weighted Nordic curl", startWeight: 10, isBodyweight: false, rangeMin: 5, rangeMax: 10, cue: "Hug one dumbbell to your chest." },
  ],
  "db-hip-thrust": [
    { name: "DB hip thrust", emailName: "Dumbbell hip thrust", startWeight: 30, isBodyweight: false, rangeMin: 10, rangeMax: 15 },
    { name: "Single-leg hip thrust", emailName: "Single-leg hip thrust", startWeight: 15, isBodyweight: false, rangeMin: 10, rangeMax: 15, repUnit: "/side" },
    { name: "Foot-elevated single-leg hip thrust", emailName: "Foot-elevated single-leg hip thrust", startWeight: 12.5, isBodyweight: false, rangeMin: 10, rangeMax: 15, repUnit: "/side", cue: "Shoulders on the bench, working foot on the mat stack." },
  ],
  "single-leg-calf-raise": [
    { name: "Single-leg calf raise", emailName: "Single-leg calf raise", startWeight: 20, isBodyweight: false, rangeMin: 10, rangeMax: 15, repUnit: "/side" },
    { name: "Deficit single-leg calf raise", emailName: "Deficit single-leg calf raise", startWeight: 25, isBodyweight: false, rangeMin: 10, rangeMax: 15, repUnit: "/side", cue: "Toes on the mat stack. Let the heel drop all the way." },
    { name: "Deficit calf raise + partials", emailName: "Deficit single-leg calf raise with lengthened partials", startWeight: 30, isBodyweight: false, rangeMin: 10, rangeMax: 15, repUnit: "/side", cue: "Half-reps out of the stretch once the full ones stop." },
  ],
  "seated-calf-raise": [
    { name: "Seated single-leg calf raise", emailName: "Seated single-leg calf raise", startWeight: 20, isBodyweight: false, rangeMin: 12, rangeMax: 20, repUnit: "/side" },
    { name: "Deficit seated calf raise", emailName: "Deficit seated single-leg calf raise", startWeight: 25, isBodyweight: false, rangeMin: 12, rangeMax: 20, repUnit: "/side", cue: "Toes on the mat stack, dumbbell on the knee." },
    { name: "Deficit seated calf raise + partials", emailName: "Deficit seated calf raise with lengthened partials", startWeight: 30, isBodyweight: false, rangeMin: 12, rangeMax: 20, repUnit: "/side" },
  ],

  // ---------------- core
  "hanging-knee-raise": [
    { name: "Hanging knee raise", emailName: "Hanging knee raise", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 12 },
    { name: "Hanging knee raise, 3 s lower", emailName: "Hanging knee raise with a slow lower", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 12, cue: "Three seconds down. No swing." },
    { name: "Weighted hanging knee raise", emailName: "Weighted hanging knee raise", startWeight: 5, isBodyweight: false, rangeMin: 8, rangeMax: 12, cue: "A dumbbell held between the feet." },
  ],
  "hanging-leg-raise": [
    { name: "Hanging leg raise", emailName: "Hanging leg raise", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 12 },
    { name: "Hanging leg raise, 3 s lower", emailName: "Hanging leg raise with a slow lower", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 12 },
    { name: "Toes to handles", emailName: "Toes to handles", startWeight: 0, isBodyweight: true, rangeMin: 6, rangeMax: 12 },
  ],
  "anti-rotation-press": [
    { name: "Half-kneeling anti-rotation press", emailName: "Half-kneeling anti-rotation press", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: " breaths/side" },
    { name: "Tall-kneeling anti-rotation press", emailName: "Tall-kneeling anti-rotation press", startWeight: 20, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: " breaths/side", cue: "Both knees down. Nothing to brace against." },
    { name: "Standing anti-rotation press-out", emailName: "Standing anti-rotation press-out", startWeight: 25, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: " breaths/side" },
  ],
  "dead-bug": [
    { name: "Dead bug", emailName: "Dead bug", startWeight: 0, isBodyweight: true, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
    { name: "Weighted dead bug", emailName: "Weighted dead bug", startWeight: 10, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side", cue: "A dumbbell held straight up over the chest." },
    { name: "Straight-leg dead bug", emailName: "Straight-leg weighted dead bug", startWeight: 12.5, isBodyweight: false, rangeMin: 8, rangeMax: 12, repUnit: "/side" },
  ],
};

/** Builds the slot from its ladder's first rung so the two can never drift. */
function slot(
  slug: string,
  key: string,
  slotDay: ExerciseDef["slotDay"],
  orderIndex: ExerciseDef["orderIndex"],
  restSeconds: number,
  category: Category,
  extra: { variantRule?: "thu-press" } = {},
): ExerciseDef {
  const v = VARIANTS[key][0];
  return {
    slug,
    key,
    name: v.name,
    slotDay,
    orderIndex,
    restSeconds,
    rangeMin: v.rangeMin,
    rangeMax: v.rangeMax,
    isUnilateral: Boolean(v.repUnit?.includes("side")),
    isBodyweight: v.isBodyweight,
    category,
    seedWeight: v.startWeight,
    seedReps: v.rangeMin,
    repUnit: v.repUnit,
    emailName: v.emailName,
    ...extra,
  };
}

export const EXERCISES: ExerciseDef[] = [
  // ---------------- Monday — Chest + core
  slot("mon-incline-db-press", "incline-db-press", 1, 1, 120, "compound"),
  slot("mon-flat-db-press", "flat-db-press", 1, 2, 120, "compound"),
  slot("mon-db-pullover", "db-pullover", 1, 3, 75, "isolation"),
  slot("mon-lateral-raise", "lateral-raise", 1, 4, 75, "isolation"),
  slot("mon-hanging-knee-raise", "hanging-knee-raise", 1, 5, 75, "hanging"),
  slot("mon-anti-rotation-press", "anti-rotation-press", 1, 6, 60, "core"),

  // ---------------- Tuesday — Back + arms
  slot("tue-pull-up", "pull-up", 2, 1, 120, "compound"),
  slot("tue-single-arm-db-row", "single-arm-db-row", 2, 2, 90, "unilateral"),
  slot("tue-chest-supported-db-row", "chest-supported-db-row", 2, 3, 90, "compound"),
  slot("tue-rear-delt-fly", "rear-delt-fly", 2, 4, 75, "isolation"),
  slot("tue-incline-db-curl", "incline-db-curl", 2, 5, 75, "isolation"),
  slot("tue-dead-bug", "dead-bug", 2, 6, 60, "core"),

  // ---------------- Wednesday — Legs + posterior
  slot("wed-goblet-squat", "goblet-squat", 3, 1, 120, "compound"),
  slot("wed-rfe-split-squat", "rfe-split-squat", 3, 2, 120, "unilateral"),
  slot("wed-db-rdl", "db-rdl", 3, 3, 90, "compound"),
  slot("wed-nordic-curl", "nordic-curl", 3, 4, 90, "compound"),
  slot("wed-db-hip-thrust", "db-hip-thrust", 3, 5, 75, "compound"),
  slot("wed-single-leg-calf-raise", "single-leg-calf-raise", 3, 6, 60, "isolation"),

  // ---------------- Thursday — Push + arms
  slot("thu-press", "thu-press", 4, 1, 120, "compound", { variantRule: "thu-press" }),
  slot("thu-seated-db-oh-press", "seated-db-oh-press", 4, 2, 120, "compound"),
  slot("thu-overhead-db-extension", "overhead-db-extension", 4, 3, 75, "isolation"),
  slot("thu-hammer-curl", "hammer-curl", 4, 4, 75, "isolation"),
  slot("thu-lateral-raise", "lateral-raise", 4, 5, 75, "isolation"),
  slot("thu-push-up", "push-up", 4, 6, 75, "compound"),

  // ---------------- Friday — Back + posterior
  slot("fri-pull-up", "pull-up", 5, 1, 120, "compound"),
  slot("fri-bent-over-row", "bent-over-row", 5, 2, 120, "compound"),
  slot("fri-reverse-lunge", "reverse-lunge", 5, 3, 90, "unilateral"),
  slot("fri-db-rdl", "db-rdl", 5, 4, 90, "compound"),
  slot("fri-hanging-leg-raise", "hanging-leg-raise", 5, 5, 75, "hanging"),
  slot("fri-seated-calf-raise", "seated-calf-raise", 5, 6, 60, "isolation"),
];

/** Unique progression keys, in first-appearance order. */
export const EXERCISE_KEYS: string[] = Array.from(new Set(EXERCISES.map((e) => e.key)));

export function exercisesForDay(day: number): ExerciseDef[] {
  return EXERCISES.filter((e) => e.slotDay === day).sort((a, b) => a.orderIndex - b.orderIndex);
}

export function exerciseByKey(key: string): ExerciseDef | undefined {
  return EXERCISES.find((e) => e.key === key);
}

/** The rung a lifter is on, clamped to the ladder. */
export function variantFor(key: string, index: number): Variant {
  const ladder = VARIANTS[key];
  if (!ladder || ladder.length === 0) throw new Error(`No ladder for ${key}`);
  return ladder[Math.max(0, Math.min(index, ladder.length - 1))];
}

/** The next rung up, or null when the ladder is finished. */
export function nextVariant(key: string, index: number): Variant | null {
  const ladder = VARIANTS[key];
  if (!ladder) return null;
  return index + 1 < ladder.length ? ladder[index + 1] : null;
}

export function ladderLength(key: string): number {
  return VARIANTS[key]?.length ?? 1;
}

/** ISO-8601 week number for a date (local calendar). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Display name for a slot on a date. The Thursday press alternates decline /
 * flat by ISO week, but only on rung 0 — once it graduates, the ladder wins.
 */
export function displayName(
  def: Pick<ExerciseDef, "name" | "variantRule">,
  date: Date,
  variantIndex = 0,
  key?: string,
): string {
  if (def.variantRule === "thu-press" && variantIndex === 0) {
    return isoWeek(date) % 2 === 0 ? "Decline DB press" : "Flat DB press";
  }
  if (key) return variantFor(key, variantIndex).name;
  return def.name;
}

/** Long-form name for email subjects ("Day 12: Dumbbell decline press"). */
export function emailName(
  def: Pick<ExerciseDef, "emailName" | "variantRule">,
  date: Date,
  variantIndex = 0,
  key?: string,
): string {
  if (def.variantRule === "thu-press" && variantIndex === 0) {
    return isoWeek(date) % 2 === 0 ? "Dumbbell decline press" : "Dumbbell flat press";
  }
  if (key) return variantFor(key, variantIndex).emailName;
  return def.emailName;
}

/** Day index 1–5 for Mon–Fri, 0 for Saturday/Sunday. */
export function dayIndexFor(date: Date): number {
  const dow = date.getDay(); // 0 Sun … 6 Sat
  return dow >= 1 && dow <= 5 ? dow : 0;
}

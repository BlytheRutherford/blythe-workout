export type SessionStatus = "in_progress" | "complete" | "abandoned";
export type LiftStatus = "pending" | "in_progress" | "completed" | "missed";
export type SetKind = "warmup" | "work";
export type SetResult = "pending" | "completed" | "missed";

export interface ProfileRow {
  id: string;
  email: string;
  role: "user" | "admin";
  height_cm: number | null;
  weight_lb: number | null;
  activity_level: "sedentary" | "lightly_active" | "moderately_active" | "returning_lifter" | "trained" | null;
  onboarded_at: string | null;
  /** Workouts before this date don't count toward the rotation or the week (set when lifts are reset). */
  program_start_on: string | null;
  created_at: string;
}

export interface StateRow {
  user_id: string;
  exercise_key: string;
  working_weight: number;
  target_reps: number;
  consecutive_hits: number;
  consecutive_misses: number;
  variant_index: number;
  note: string | null;
  last_hit_weight: number | null;
  last_hit_reps: number | null;
  last_logged_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  session_date: string;
  /** Position in the rotation, 1–5 (Day 1 … Day 5). */
  day_index: number;
  day_number: number | null;
  status: SessionStatus;
  started_at: string;
  completed_at: string | null;
}

export interface LiftRow {
  id: string;
  session_id: string;
  user_id: string;
  exercise_id: number;
  exercise_key: string;
  display_name: string;
  variant_index: number;
  order_index: number;
  prescribed_weight: number;
  prescribed_reps: number;
  rest_seconds: number;
  note: string | null;
  status: LiftStatus;
  progression_applied: boolean;
  started_at: string | null;
  finished_at: string | null;
}

export interface SetRow {
  id: string;
  session_id: string;
  lift_id: string;
  user_id: string;
  kind: SetKind;
  set_number: number;
  prescribed_weight: number;
  prescribed_reps: number;
  actual_weight: number | null;
  actual_reps: number | null;
  result: SetResult;
  logged_at: string | null;
  rest_skipped: boolean;
}

export interface ExerciseRow {
  id: number;
  slug: string;
  exercise_key: string;
  name: string;
  slot_day: number;
  order_index: number;
  rest_seconds: number;
  range_min: number;
  range_max: number;
  is_unilateral: boolean;
  is_bodyweight: boolean;
  category: string;
  seed_weight: number;
  seed_reps: number;
  variant_rule: string | null;
  rep_unit: string | null;
}

/** Everything the live screen needs for the day. */
export interface SessionBundle {
  session: SessionRow;
  lifts: (LiftRow & {
    sets: SetRow[];
    exercise: ExerciseRow;
    lastLog: { weight: number; reps: number } | null;
    formVideoPath: string | null;
  })[];
}

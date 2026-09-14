import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, snapToLegal } from "@/lib/engine";
import { ensureExerciseStates, getProfile } from "./service";
import type { LocalDay } from "./dates";
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

/**
 * Seeds the admin account so Monday is immediately trainable.
 *   ADMIN_EMAIL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node --experimental-strip-types scripts/seed-admin.ts
 *
 * - writes app_config.admin_email (the auth trigger promotes that address)
 * - creates the auth user (confirmed) if missing, with a random throwaway password
 * - marks the profile admin + onboarded (activity: trained) and seeds every lift's starting load
 * - the admin sets a real password through "Reset password" on the sign-in screen
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { EXERCISE_KEYS, exerciseByKey } from "../lib/engine/program";
import { startingState } from "../lib/engine/starting";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const weightLb = Number(process.env.ADMIN_WEIGHT_LB ?? 0) || null;
if (!url || !key || !email) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ADMIN_EMAIL");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { error: cfgErr } = await admin.from("app_config").upsert({ key: "admin_email", value: email }, { onConflict: "key" });
  if (cfgErr) throw cfgErr;

  // Find or create the auth user.
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) userId = hit.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    const password = randomBytes(24).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
    console.log("created auth user", userId);
  } else {
    console.log("auth user exists", userId);
  }

  const calibrationEnds = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10);
  const { error: profErr } = await admin.from("users").upsert(
    {
      id: userId,
      email,
      role: "admin",
      activity_level: "trained",
      weight_lb: weightLb,
      onboarded_at: new Date().toISOString(),
      calibration_ends_on: calibrationEnds,
    },
    { onConflict: "id" },
  );
  if (profErr) throw profErr;

  const { data: existing } = await admin.from("user_exercise_state").select("exercise_key").eq("user_id", userId);
  const have = new Set((existing ?? []).map((r) => r.exercise_key as string));
  const rows = EXERCISE_KEYS.filter((k) => !have.has(k)).map((k) => {
    const def = exerciseByKey(k)!;
    const s = startingState(def, "trained", weightLb);
    return { user_id: userId, exercise_key: k, working_weight: s.weight, target_reps: s.targetReps, consecutive_hits: 0, consecutive_misses: 0, note: null };
  });
  if (rows.length) {
    const { error } = await admin.from("user_exercise_state").insert(rows);
    if (error) throw error;
  }
  console.log(`admin ${email} ready · role=admin · ${rows.length} lifts seeded · calibration until ${calibrationEnds}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

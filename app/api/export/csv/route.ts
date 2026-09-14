import { withUser } from "@/lib/api";

/** Every set the user has logged, one row each. */
export const GET = withUser(async ({ db, user }) => {
  const { data: sessions } = await db
    .from("sessions")
    .select("id, session_date, day_index, day_number, status")
    .eq("user_id", user.id)
    .order("session_date");
  const { data: lifts } = await db.from("session_lifts").select("id, session_id, display_name, exercise_key, order_index, status").eq("user_id", user.id);
  const { data: sets } = await db
    .from("session_sets")
    .select("session_id, lift_id, kind, set_number, prescribed_weight, prescribed_reps, actual_weight, actual_reps, result, logged_at")
    .eq("user_id", user.id);

  const sById = new Map((sessions ?? []).map((s) => [s.id, s]));
  const lById = new Map((lifts ?? []).map((l) => [l.id, l]));
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["date", "day_number", "session_status", "lift_order", "lift", "exercise_key", "lift_status", "set_kind", "set_number", "prescribed_weight", "prescribed_reps", "actual_weight", "actual_reps", "result", "logged_at"],
  ];
  const sorted = (sets ?? []).sort((a, b) => {
    const sa = sById.get(a.session_id)?.session_date ?? "";
    const sb = sById.get(b.session_id)?.session_date ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    const la = lById.get(a.lift_id)?.order_index ?? 0;
    const lb = lById.get(b.lift_id)?.order_index ?? 0;
    return la - lb || (a.kind === b.kind ? a.set_number - b.set_number : a.kind === "warmup" ? -1 : 1);
  });
  for (const s of sorted) {
    const sess = sById.get(s.session_id);
    const lift = lById.get(s.lift_id);
    rows.push([
      sess?.session_date, sess?.day_number, sess?.status, lift?.order_index, lift?.display_name, lift?.exercise_key, lift?.status,
      s.kind, s.set_number, s.prescribed_weight, s.prescribed_reps, s.actual_weight, s.actual_reps, s.result, s.logged_at,
    ].map(String) as string[]);
  }
  const csv = rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="blythe-workout-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

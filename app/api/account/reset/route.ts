import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { resetProgress } from "@/lib/session/service";
import { createAdminClient } from "@/lib/supabase/server";

/** Wipes every session, set, clip, video and lift state; restarts at Day 1 with fresh starting loads. */
export const POST = withUser(async ({ db, user }) => {
  const admin = createAdminClient();
  const { data: dirs } = await admin.storage.from("sessions").list(user.id, { limit: 1000 });
  for (const d of dirs ?? []) {
    const { data: files } = await admin.storage.from("sessions").list(`${user.id}/${d.name}`, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${user.id}/${d.name}/${f.name}`);
    if (paths.length) await admin.storage.from("sessions").remove(paths);
  }
  await resetProgress(db, user.id);
  return NextResponse.json({ ok: true });
});

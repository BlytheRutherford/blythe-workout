import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Daily: delete day videos / zips / leftover clips older than 8 days
 * (signed links last 7). Vercel Cron sends Authorization: Bearer CRON_SECRET.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const { data: sessions } = await admin
    .from("sessions")
    .select("id, user_id, session_date, video_path")
    .lt("session_date", cutoff)
    .not("video_path", "is", null)
    .limit(200);
  let removed = 0;
  for (const s of sessions ?? []) {
    const prefix = `${s.user_id}/${s.session_date}`;
    const { data: files } = await admin.storage.from("sessions").list(prefix, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length) {
      const { error } = await admin.storage.from("sessions").remove(paths);
      if (!error) removed += paths.length;
    }
    await admin.from("sessions").update({ video_path: null }).eq("id", s.id);
  }
  // Orphan clips from days that never completed.
  const { data: stale } = await admin.from("clips").select("id, storage_path").lt("created_at", new Date(Date.now() - 8 * 86400000).toISOString()).limit(500);
  if (stale?.length) {
    await admin.storage.from("sessions").remove(stale.map((c) => c.storage_path));
    await admin.from("clips").delete().in("id", stale.map((c) => c.id));
    removed += stale.length;
  }
  return NextResponse.json({ ok: true, removed });
}

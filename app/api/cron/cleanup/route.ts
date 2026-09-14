import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processLiftIfReady } from "@/lib/video/stitch";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily (Vercel Cron, Authorization: Bearer CRON_SECRET):
 *  - delete every video / clip under sessions/{user}/{date} older than 8 days (signed links last 7)
 *  - sweep completed lifts whose email is still pending/stuck for over an hour
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const { data: sessions } = await admin.from("sessions").select("id, user_id, session_date").lt("session_date", cutoff).limit(300);
  let removed = 0;
  for (const s of sessions ?? []) {
    const prefix = `${s.user_id}/${s.session_date}`;
    const { data: files } = await admin.storage.from("sessions").list(prefix, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length) {
      const { error } = await admin.storage.from("sessions").remove(paths);
      if (!error) removed += paths.length;
    }
    await admin.from("session_lifts").update({ video_path: null }).eq("session_id", s.id).not("video_path", "is", null);
    await admin.from("clips").delete().eq("session_id", s.id);
  }
  const staleBefore = new Date(Date.now() - 3600_000).toISOString();
  const { data: stuck } = await admin
    .from("session_lifts")
    .select("id")
    .eq("status", "completed")
    .in("email_status", ["pending", "stitching"])
    .lt("finished_at", staleBefore)
    .limit(20);
  let swept = 0;
  for (const l of stuck ?? []) {
    await processLiftIfReady(l.id, true);
    swept++;
  }
  return NextResponse.json({ ok: true, removed, swept });
}

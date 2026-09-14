import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { EXERCISE_KEYS } from "@/lib/engine";
import { getProfile } from "@/lib/session/service";

export const POST = withUser(async ({ db, user, request }) => {
  const profile = await getProfile(db, user.id);
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const b = await readJson<{ exerciseKey: string; storagePath: string; mime: string; bytes: number }>(request);
  if (!EXERCISE_KEYS.includes(b.exerciseKey)) return NextResponse.json({ error: "Unknown lift." }, { status: 400 });
  if (!b.storagePath?.startsWith(`${b.exerciseKey}.`)) return NextResponse.json({ error: "Bad path." }, { status: 400 });
  const { error } = await db
    .from("form_videos")
    .upsert({ exercise_key: b.exerciseKey, storage_path: b.storagePath, mime: b.mime || "video/mp4", bytes: Number(b.bytes) || null, updated_at: new Date().toISOString(), updated_by: user.id }, { onConflict: "exercise_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

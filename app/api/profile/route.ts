import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";

export const PATCH = withUser(async ({ db, user, request }) => {
  const b = await readJson<{ deliveryEmail?: string; burnOverlay?: boolean; recordAudio?: boolean }>(request);
  const patch: Record<string, unknown> = {};
  if (typeof b.deliveryEmail === "string") {
    const v = b.deliveryEmail.trim().toLowerCase();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return NextResponse.json({ error: "That doesn't look like an email." }, { status: 400 });
    patch.delivery_email = v || null;
  }
  if (typeof b.burnOverlay === "boolean") patch.burn_overlay = b.burnOverlay;
  if (typeof b.recordAudio === "boolean") patch.record_audio = b.recordAudio;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });
  const { error } = await db.from("users").update(patch).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

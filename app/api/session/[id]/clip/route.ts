import { NextResponse } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { recordClip } from "@/lib/session/service";

interface Body {
  liftId: string;
  setNumber: number;
  storagePath: string;
  mime: string;
  bytes: number;
  durationMs: number;
  trimmedMs: number;
}

export const POST = withUser(async ({ db, user, request, params }) => {
  const b = await readJson<Body>(request);
  if (!b.liftId || !b.storagePath || !b.mime) return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  if (!b.storagePath.startsWith(`${user.id}/`)) return NextResponse.json({ error: "Bad path." }, { status: 400 });
  const clip = await recordClip(db, user.id, {
    sessionId: params.id,
    liftId: b.liftId,
    setNumber: Number(b.setNumber) || 1,
    storagePath: b.storagePath,
    mime: b.mime,
    bytes: Number(b.bytes) || 0,
    durationMs: Number(b.durationMs) || 0,
    trimmedMs: Number(b.trimmedMs) || 0,
  });
  return NextResponse.json({ ok: true, clipId: clip.id });
});

import { NextResponse, after } from "next/server";
import { readJson, withUser } from "@/lib/api";
import { recordClip } from "@/lib/session/service";
import { processLiftIfReady } from "@/lib/video/stitch";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  // The last clip of a completed lift kicks off the stitch + email.
  after(() => processLiftIfReady(b.liftId));
  return NextResponse.json({ ok: true, clipId: clip.id });
});

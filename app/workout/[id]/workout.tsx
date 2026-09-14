"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Digits, Pill, Select } from "@/components/ui";
import { formatLoad, LEGAL_LOADS } from "@/lib/engine";
import type { SessionBundle, SetRow } from "@/lib/session/types";
import { getCamera, isFrontCamera, releaseCamera } from "@/lib/video/camera";
import { Recorder, type RecordingResult } from "@/lib/video/recorder";
import { uploadQueue } from "@/lib/video/uploads";
import { acquireWakeLock, releaseWakeLock } from "@/lib/video/wakelock";

type Lift = SessionBundle["lifts"][number];

type Phase =
  | { kind: "live" }
  | { kind: "countdown"; n: number }
  | { kind: "recording" }
  | { kind: "saving" }
  | { kind: "rest"; endsAt: number; startedAt: number; logged: string; next: string; setId: string }
  | { kind: "finishing"; message: string }
  | { kind: "error"; message: string };

interface Props {
  bundle: SessionBundle;
  userId: string;
  dayShort: string;
  dayNumber: number;
  calibrating: boolean;
  burnOverlay: boolean;
  /** Only accounts with records_video see the camera flow; everyone else logs sets directly. */
  recordsVideo: boolean;
  /** Microphone capture is off by default so background music keeps playing on iPhone. */
  recordAudio: boolean;
  tz: string;
}

const WARMUP_REST = 45;
const BETWEEN_LIFTS_REST = 90;

function pending(lift: Lift): SetRow | null {
  const order = { warmup: 0, work: 1 } as const;
  const sets = [...lift.sets].sort((a, b) => order[a.kind] - order[b.kind] || a.set_number - b.set_number);
  return sets.find((s) => s.result === "pending") ?? null;
}

function isOpen(l: Lift) {
  return l.status === "pending" || l.status === "in_progress";
}

function restEndsAt(seconds: number) {
  return Date.now() + seconds * 1000;
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Workout({ bundle: initial, userId, dayShort, dayNumber, calibrating, burnOverlay, recordsVideo, recordAudio, tz }: Props) {
  const router = useRouter();
  const [bundle, setBundle] = useState<SessionBundle>(initial);
  const [phase, setPhase] = useState<Phase>({ kind: "live" });
  const [cameraFailed, setCameraFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploads, setUploads] = useState({ pending: 0, failed: 0 });
  const [busy, setBusy] = useState(false);
  const [mirror, setMirror] = useState(true);

  const recorder = useRef<Recorder | null>(null);
  const phaseRef = useRef<Phase>({ kind: "live" });
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const countdownTimer = useRef<number | null>(null);

  const session = bundle.session;
  const liftIdx = bundle.lifts.findIndex(isOpen);
  const lift = liftIdx >= 0 ? bundle.lifts[liftIdx] : null;
  const set = lift ? pending(lift) : null;
  const workSets = useMemo(() => (lift ? lift.sets.filter((s) => s.kind === "work") : []), [lift]);
  const warmups = useMemo(() => (lift ? lift.sets.filter((s) => s.kind === "warmup") : []), [lift]);

  // ---- lifecycle: wake lock, upload queue, camera release
  useEffect(() => {
    acquireWakeLock();
    uploadQueue.restore(session.id);
    const unsub = uploadQueue.subscribe((p, f) => setUploads({ pending: p, failed: f }));
    const onVis = () => {
      if (document.visibilityState === "visible") acquireWakeLock();
      else {
        // Backgrounded: iOS suspends capture anyway. Release so the next RECORD re-acquires cleanly.
        if (phaseRef.current.kind !== "recording") releaseCamera();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      unsub();
      releaseWakeLock();
      recorder.current?.cancel();
      releaseCamera();
    };
  }, [session.id]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // ---- tickers + rest auto-advance (no skip: the only way out of rest is 0:00)
  useEffect(() => {
    if (phase.kind !== "recording" && phase.kind !== "rest") return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (phase.kind === "recording") setElapsed(recorder.current?.elapsed() ?? 0);
      if (phase.kind === "rest" && t >= phase.endsAt) setPhase({ kind: "live" });
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  // ---- attach camera stream to the preview element
  const attachPreview = useCallback(async (stream: MediaStream) => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    try {
      await v.play();
    } catch {}
  }, []);

  // ---- RECORD
  async function onRecord() {
    if (!lift || !set) return;
    setBusy(true);
    try {
      const stream = await getCamera(recordAudio);
      await attachPreview(stream);
      setMirror(isFrontCamera());
      setCameraFailed(false);
      setBusy(false);
      runCountdown(3);
    } catch {
      setBusy(false);
      setCameraFailed(true);
      // Fallback: pick from Camera Roll (or record with the native camera app).
      fileRef.current?.click();
    }
  }

  function runCountdown(n: number) {
    setPhase({ kind: "countdown", n });
    countdownTimer.current = window.setTimeout(() => {
      if (n > 1) runCountdown(n - 1);
      else startRecording();
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownTimer.current) window.clearTimeout(countdownTimer.current);
    countdownTimer.current = null;
    setPhase({ kind: "live" });
  }

  function startRecording() {
    if (!lift || !set) return;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (!stream) {
      setPhase({ kind: "live" });
      setCameraFailed(true);
      return;
    }
    const rec = new Recorder();
    recorder.current = rec;
    try {
      rec.start(
        stream,
        videoRef.current,
        burnOverlay
          ? { line1: `${dayShort} · DAY ${dayNumber} · ${lift.display_name.toUpperCase()}`, line2: `${formatLoad(set.prescribed_weight)} × ${set.prescribed_reps}` }
          : null,
      );
      setElapsed(0);
      setPhase({ kind: "recording" });
    } catch (e) {
      recorder.current = null;
      setPhase({ kind: "error", message: `Recording could not start (${(e as Error).message}).` });
    }
  }

  // ---- LOG SET
  async function onLogSet() {
    if (!lift || !set || !recorder.current) return;
    setPhase({ kind: "saving" });
    let result: RecordingResult | null = null;
    try {
      result = await recorder.current.stop();
    } catch {
      result = null;
    }
    recorder.current = null;
    await commitSet(lift, set, result ? { blob: result.blob, mime: result.mime, durationMs: result.durationMs, trimmedMs: result.trimmedMs } : null);
  }

  async function onPickedFile(file: File | null) {
    if (!lift || !set) return;
    if (!file) return; // cancelled → stay on live; the faint link below allows logging without video
    setPhase({ kind: "saving" });
    await commitSet(lift, set, { blob: file, mime: file.type || "video/mp4", durationMs: 0, trimmedMs: 0 });
  }

  async function logWithoutVideo() {
    if (!lift || !set) return;
    setPhase({ kind: "saving" });
    await commitSet(lift, set, null);
  }

  async function commitSet(l: Lift, s: SetRow, clip: { blob: Blob; mime: string; durationMs: number; trimmedMs: number } | null) {
    if (clip && s.kind === "work") {
      await uploadQueue.enqueue({
        id: `${l.id}-${s.set_number}`,
        sessionId: session.id,
        liftId: l.id,
        setNumber: s.set_number,
        exerciseKey: l.exercise_key,
        ymd: session.session_date,
        userId,
        mime: clip.mime,
        durationMs: clip.durationMs,
        trimmedMs: clip.trimmedMs,
        blob: clip.blob,
      });
    }

    let ok = false;
    let liftCompleted = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const res = await fetch(`/api/session/${session.id}/log-set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setId: s.id, kind: s.kind, hasClip: Boolean(clip) && s.kind === "work" }),
        });
        if (res.ok) {
          const j = await res.json();
          liftCompleted = Boolean(j.liftCompleted);
          ok = true;
        } else if (res.status === 409) {
          ok = true; // already logged / closed — treat as done
        } else {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      } catch {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    if (!ok) {
      setPhase({ kind: "error", message: "Couldn't save the set. Check your connection and try again." });
      return;
    }

    // Local update
    const isLastWork = s.kind === "work" && workSets.filter((w) => w.result !== "completed" && w.id !== s.id).length === 0;
    liftCompleted = liftCompleted || isLastWork;
    const nextBundle: SessionBundle = {
      ...bundle,
      lifts: bundle.lifts.map((x) =>
        x.id !== l.id
          ? x
          : {
              ...x,
              status: liftCompleted ? "completed" : "in_progress",
              sets: x.sets.map((y) => (y.id === s.id ? { ...y, result: "completed", actual_weight: y.prescribed_weight, actual_reps: y.prescribed_reps } : y)),
            },
      ),
    };
    setBundle(nextBundle);

    const nextLift = nextBundle.lifts.find(isOpen) ?? null;
    if (liftCompleted && !nextLift) {
      await finishDay();
      return;
    }

    const restSeconds = s.kind === "warmup" ? WARMUP_REST : liftCompleted ? BETWEEN_LIFTS_REST : l.rest_seconds;
    const logged = s.kind === "warmup" ? "Warm-up logged." : `${l.display_name} logged.`;
    let next: string;
    if (liftCompleted && nextLift) {
      next = `next · ${nextLift.display_name.toLowerCase()} ${formatLoad(nextLift.prescribed_weight)} × ${nextLift.prescribed_reps}`;
    } else {
      const ns = pending(nextBundle.lifts.find((x) => x.id === l.id)!);
      next = ns
        ? ns.kind === "warmup"
          ? `next · warm-up ${formatLoad(ns.prescribed_weight)} × ${ns.prescribed_reps}`
          : `next · set ${ns.set_number} of 3 · ${formatLoad(ns.prescribed_weight)} × ${ns.prescribed_reps}`
        : "";
    }
    setPhase({ kind: "rest", endsAt: restEndsAt(restSeconds), startedAt: restEndsAt(0), logged, next, setId: s.id });
  }

  async function finishDay() {
    setPhase({ kind: "finishing", message: "Saving clips…" });
    releaseCamera();
    const drained = await uploadQueue.drain(180_000);
    setPhase({ kind: "finishing", message: drained.ok ? "Finishing…" : "Finishing (some clips still uploading)…" });
    try {
      const res = await fetch(`/api/session/${session.id}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(`complete ${res.status}`);
    } catch {
      setPhase({ kind: "error", message: "Couldn't close the day. Check your connection and tap DONE again." });
      return;
    }
    router.replace(`/workout/${session.id}/complete`);
  }

  // ---- leave lift (counts as a miss)
  async function leaveLift() {
    if (!lift) return;
    setBusy(true);
    try {
      await fetch(`/api/session/${session.id}/leave-lift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liftId: lift.id }),
      });
    } catch {}
    const nextBundle: SessionBundle = {
      ...bundle,
      lifts: bundle.lifts.map((x) => (x.id === lift.id ? { ...x, status: "missed", sets: x.sets.map((y) => (y.result === "pending" ? { ...y, result: "missed" } : y)) } : x)),
    };
    setBundle(nextBundle);
    setMenuOpen(false);
    setBusy(false);
    if (!nextBundle.lifts.find(isOpen)) await finishDay();
    else setPhase({ kind: "live" });
  }

  // ---- skip rest (allowed, discouraged, recorded on the set)
  async function skipRest() {
    if (phase.kind !== "rest") return;
    const setId = phase.setId;
    setPhase({ kind: "live" });
    try {
      await fetch(`/api/session/${session.id}/skip-rest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId }),
      });
    } catch {}
  }

  // ---- calibration
  async function changeStartingWeight(weight: number) {
    if (!lift) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/session/${session.id}/starting-weight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseKey: lift.exercise_key, weight, tz }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ---- everything resolved (e.g. reopened after the last lift) → finish
  const allDone = !lift || !set;
  useEffect(() => {
    if (allDone && phaseRef.current.kind !== "finishing" && phaseRef.current.kind !== "error") void finishDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  // ================================================================ render

  const heroValue = set ? `${formatLoad(set.prescribed_weight)} × ${set.prescribed_reps}` : "";
  const repUnit = lift?.exercise.rep_unit ?? "";

  return (
    <div className="fixed inset-0 bg-bg text-text overflow-hidden">
      {/* Camera layer — always mounted so the preview is warm when the countdown ends. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 w-full h-full object-cover bg-black ${mirror ? "-scale-x-100" : ""} ${phase.kind === "recording" || phase.kind === "saving" ? "opacity-100" : "opacity-0"}`}
      />
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          void onPickedFile(f);
        }}
      />

      {/* ---------------- LIVE */}
      {phase.kind === "live" && lift && set && (
        <main className="absolute inset-0 flex flex-col px-6 safe-top safe-bottom">
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Menu" className="faint py-2 pr-4 -ml-1 text-[18px] leading-none" onClick={() => setMenuOpen((v) => !v)}>
              ‹
            </button>
            <div className="title text-[13px]">
              {dayShort} · {liftIdx + 1}/{bundle.lifts.length}
            </div>
            <span className="w-6" />
          </div>

          {menuOpen && (
            <div className="mt-4 border-b hairline pb-5">
              <p className="faint mb-4">Your logged sets are saved. Come back today and the workout picks up right here.</p>
              <div className="flex flex-col items-start gap-3">
                <Link href="/week" className="link">
                  The week
                </Link>
                <Link href="/history" className="link">
                  History
                </Link>
                <Link href="/settings" className="link">
                  Settings
                </Link>
                <button type="button" className="link" onClick={leaveLift} disabled={busy}>
                  Skip {lift.display_name} · counts as a miss
                </button>
                <button type="button" className="link text-text" onClick={() => setMenuOpen(false)}>
                  Back to the set
                </button>
              </div>
            </div>
          )}

          <h1 className="title text-[24px] mt-8 leading-tight">{lift.display_name}</h1>
          {lift.formVideoPath && (
            <a href={`/api/form-video/${lift.exercise_key}`} target="_blank" rel="noreferrer" className="link mt-2 self-start text-[14px]">
              Form video
            </a>
          )}

          <div className="flex-1 flex flex-col justify-center">
            <div className="title text-[12px] text-text-dim mb-3">
              {set.kind === "warmup" ? `Warm-up ${set.set_number} of ${warmups.length}` : "This log"}
            </div>
            <div className="hero text-[88px]">
              <Digits value={heroValue} />
            </div>
            {repUnit && set.kind === "work" && <div className="caption mt-1">reps{repUnit}</div>}
            {set.kind === "work" && lift.lastLog && (
              <div className="caption mt-4">
                last log {formatLoad(lift.lastLog.weight)} × {lift.lastLog.reps}
              </div>
            )}
            {set.kind === "work" && !lift.lastLog && lift.note && <div className="caption mt-4">{lift.note}</div>}
            {set.kind === "work" && lift.lastLog && lift.note && <div className="faint mt-1">{lift.note}</div>}

            <div className="flex gap-3 mt-8">
              {workSets.map((w) => (
                <span key={w.id} className={`pip ${w.result === "completed" ? "pip-done" : w.id === set.id ? "pip-current" : ""}`} />
              ))}
            </div>

            {calibrating && lift.status === "pending" && !lift.exercise.is_bodyweight && (
              <div className="mt-8">
                <label className="caption block">
                  Change starting weight
                  <Select
                    className="field mt-1"
                    value={String(lift.prescribed_weight)}
                    disabled={busy}
                    onChange={(e) => changeStartingWeight(Number(e.target.value))}
                  >
                    {LEGAL_LOADS.map((w) => (
                      <option key={w} value={String(w)}>
                        {formatLoad(w)} lb
                      </option>
                    ))}
                  </Select>
                </label>
                <p className="faint mt-2">(First two weeks only. After that this lift cannot be adjusted.)</p>
              </div>
            )}
          </div>

          {uploads.failed > 0 && (
            <button type="button" className="faint text-left mb-3" onClick={() => uploadQueue.retryFailed()}>
              {uploads.failed} clip{uploads.failed > 1 ? "s" : ""} failed to upload · tap to retry
            </button>
          )}

          {set.kind === "warmup" ? (
            <Pill onClick={logWithoutVideo} disabled={busy}>
              Warm-up done
            </Pill>
          ) : !recordsVideo ? (
            <Pill onClick={logWithoutVideo} disabled={busy}>
              Log set
            </Pill>
          ) : (
            <>
              <Pill onClick={onRecord} disabled={busy}>
                {busy ? "Opening camera…" : "Record"}
              </Pill>
              {cameraFailed && (
                <div className="flex justify-between mt-4">
                  <button type="button" className="link" onClick={() => fileRef.current?.click()}>
                    Choose from Camera Roll
                  </button>
                  <button type="button" className="link" onClick={logWithoutVideo}>
                    Log without video
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      )}

      {/* ---------------- COUNTDOWN */}
      {phase.kind === "countdown" && lift && (
        <button type="button" onClick={cancelCountdown} className="absolute inset-0 flex flex-col items-center justify-center bg-bg text-text">
          <div className="hero text-[220px]">
            <Digits value={String(phase.n)} />
          </div>
          <div className="title text-[18px] mt-6">{lift.display_name}</div>
          <div className="faint mt-10">tap to cancel</div>
        </button>
      )}

      {/* ---------------- RECORDING */}
      {(phase.kind === "recording" || phase.kind === "saving") && lift && set && (
        <div className="absolute inset-0 flex flex-col">
          <div className="px-6 safe-top pt-4 flex items-start justify-between bg-gradient-to-b from-black/60 to-transparent pb-8">
            <div>
              <div className="title text-[12px]">
                {dayShort} · DAY {dayNumber} · {lift.display_name.toUpperCase()}
              </div>
              <div className="hero text-[40px] mt-1">
                <Digits value={heroValue} />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="rec-dot" />
              <span className="text-[13px] tracking-[0.1em] uppercase">
                REC <Digits value={mmss(elapsed)} />
              </span>
            </div>
          </div>
          <div className="flex-1" />
          <div className="px-6 safe-bottom pb-4 bg-gradient-to-t from-black/70 to-transparent pt-10">
            <Pill onClick={onLogSet} disabled={phase.kind === "saving"}>
              {phase.kind === "saving" ? "Saving…" : "Log set"}
            </Pill>
          </div>
        </div>
      )}

      {/* ---------------- REST */}
      {phase.kind === "rest" && (
        <main className="absolute inset-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom bg-bg">
          <div className="hero text-[136px]">
            <Digits value={mmss(phase.endsAt - now)} />
          </div>
          <div className="caption mt-6">{phase.logged}</div>
          <div className="absolute bottom-0 left-0 right-0 px-6 safe-bottom pb-6 text-center">
            <div className="faint">{phase.next}</div>
            <button type="button" onClick={skipRest} className="faint mt-5 underline underline-offset-4 decoration-[#2A2A28]">
              skip rest
            </button>
          </div>
        </main>
      )}

      {/* ---------------- FINISHING / ERROR */}
      {(phase.kind === "finishing" || phase.kind === "error") && (
        <main className="absolute inset-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom bg-bg">
          <div className="caption text-center">{phase.message}</div>
          {phase.kind === "error" && (
            <div className="w-full mt-10">
              <Pill onClick={() => (lift && set ? setPhase({ kind: "live" }) : finishDay())}>{lift && set ? "Back" : "Done"}</Pill>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

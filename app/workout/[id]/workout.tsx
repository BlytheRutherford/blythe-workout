"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Digits, Pill } from "@/components/ui";
import { formatLoad, nextLegal, prevLegal, MAX_LOAD, MIN_LOAD } from "@/lib/engine";
import type { SessionBundle, SetRow } from "@/lib/session/types";
import { acquireWakeLock, releaseWakeLock } from "@/lib/wakelock";

type Lift = SessionBundle["lifts"][number];

type Phase =
  | { kind: "live" }
  | { kind: "saving" }
  | { kind: "rest"; endsAt: number; total: number; logged: string; next: string; setId: string }
  | { kind: "finishing"; message: string }
  | { kind: "error"; message: string };

interface Props {
  bundle: SessionBundle;
  dayLabel: string;
  dayName: string;
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

function clock() {
  return Date.now();
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function repsLabel(reps: number, unit: string | null) {
  if (!unit) return `${reps} reps`;
  return unit.startsWith("/") ? `${reps} reps${unit}` : `${reps}${unit}`;
}

/** The rest timer: an ember ring that drains to zero. */
function RestRing({ remaining, total }: { remaining: number; total: number }) {
  const r = 132;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  return (
    <div className="relative w-[300px] h-[300px] max-w-[80vw] max-h-[80vw]">
      <svg viewBox="0 0 300 300" className="absolute inset-0 w-full h-full -rotate-90" aria-hidden>
        <circle cx="150" cy="150" r={r} fill="none" stroke="var(--umber)" strokeWidth="10" />
        <circle
          cx="150"
          cy="150"
          r={r}
          fill="none"
          stroke="var(--ember)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: "stroke-dashoffset 250ms linear", filter: "drop-shadow(0 0 10px rgba(244,44,29,0.55))" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center hero text-[104px]">
        <Digits value={mmss(remaining)} />
      </div>
    </div>
  );
}

export function Workout({ bundle: initial, dayLabel, dayName }: Props) {
  const router = useRouter();
  const [bundle, setBundle] = useState<SessionBundle>(initial);
  const [phase, setPhase] = useState<Phase>({ kind: "live" });
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const phaseRef = useRef<Phase>({ kind: "live" });
  const adjustTimer = useRef<number | null>(null);

  const session = bundle.session;
  const liftIdx = bundle.lifts.findIndex(isOpen);
  const lift = liftIdx >= 0 ? bundle.lifts[liftIdx] : null;
  const set = lift ? pending(lift) : null;
  const workSets = useMemo(() => (lift ? lift.sets.filter((s) => s.kind === "work") : []), [lift]);
  const warmups = useMemo(() => (lift ? lift.sets.filter((s) => s.kind === "warmup") : []), [lift]);

  // ---- keep the screen on while the workout is open
  useEffect(() => {
    acquireWakeLock();
    const onVis = () => {
      if (document.visibilityState === "visible") acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // ---- rest ticker + auto-advance at 0:00
  useEffect(() => {
    if (phase.kind !== "rest") return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= phase.endsAt) setPhase({ kind: "live" });
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  // ---- change the weight for this set and the ones after it
  function changeWeight(dir: 1 | -1) {
    if (!lift || !set || set.kind !== "work") return;
    const current = set.prescribed_weight;
    const next = dir > 0 ? nextLegal(current) : prevLegal(current);
    if (next === current) return;
    setBundle((b) => ({
      ...b,
      lifts: b.lifts.map((x) =>
        x.id !== lift.id ? x : { ...x, sets: x.sets.map((y) => (y.kind === "work" && y.result === "pending" ? { ...y, prescribed_weight: next } : y)) },
      ),
    }));
    // Saved so a reload keeps it; LOG SET also carries the weight, so this is only a backup.
    if (adjustTimer.current) window.clearTimeout(adjustTimer.current);
    const liftId = lift.id;
    adjustTimer.current = window.setTimeout(() => {
      adjustTimer.current = null;
      void fetch(`/api/session/${session.id}/adjust-weight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liftId, weight: next }),
      }).catch(() => {});
    }, 700);
  }

  // ---- LOG SET
  async function logSet() {
    if (!lift || !set) return;
    if (adjustTimer.current) {
      window.clearTimeout(adjustTimer.current);
      adjustTimer.current = null;
    }
    setPhase({ kind: "saving" });
    const l = lift;
    const s = set;

    let ok = false;
    let liftCompleted = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const res = await fetch(`/api/session/${session.id}/log-set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setId: s.id, kind: s.kind, weight: s.kind === "work" && !l.exercise.is_bodyweight ? s.prescribed_weight : undefined }),
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
    const logged = s.kind === "warmup" ? "Warm-up logged" : liftCompleted ? `${l.display_name} done` : `Set ${s.set_number} logged`;
    let next: string;
    if (liftCompleted && nextLift) {
      const ns = pending(nextLift);
      next = `Next: ${nextLift.display_name}, ${formatLoad(ns?.prescribed_weight ?? nextLift.prescribed_weight)} × ${nextLift.prescribed_reps}`;
    } else {
      const ns = pending(nextBundle.lifts.find((x) => x.id === l.id)!);
      next = ns
        ? ns.kind === "warmup"
          ? `Next: warm-up, ${formatLoad(ns.prescribed_weight)} × ${ns.prescribed_reps}`
          : `Next: set ${ns.set_number} of 3, ${formatLoad(ns.prescribed_weight)} × ${ns.prescribed_reps}`
        : "";
    }
    const startedAt = clock();
    setPhase({ kind: "rest", endsAt: startedAt + restSeconds * 1000, total: restSeconds * 1000, logged, next, setId: s.id });
    setNow(startedAt);
  }

  async function finishDay() {
    setPhase({ kind: "finishing", message: "Saving your workout…" });
    try {
      const res = await fetch(`/api/session/${session.id}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(`complete ${res.status}`);
    } catch {
      setPhase({ kind: "error", message: "Couldn't close the workout. Check your connection and tap Done again." });
      return;
    }
    router.replace(`/workout/${session.id}/complete`);
  }

  // ---- skip a lift (counts as a miss)
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

  // ---- everything resolved (e.g. reopened after the last lift) → finish
  const allDone = !lift || !set;
  useEffect(() => {
    if (allDone && phaseRef.current.kind !== "finishing" && phaseRef.current.kind !== "error") void finishDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  // ================================================================ render

  const repUnit = lift?.exercise.rep_unit ?? null;
  const loaded = Boolean(lift && !lift.exercise.is_bodyweight && set && set.prescribed_weight > 0);
  const canAdjust = Boolean(lift && set && set.kind === "work" && loaded);
  const changed = Boolean(lift && set && set.kind === "work" && loaded && set.prescribed_weight !== lift.prescribed_weight);

  return (
    <div className="fixed inset-0 text-bone overflow-hidden">
      {/* ---------------- LIVE */}
      {(phase.kind === "live" || phase.kind === "saving") && lift && set && (
        <main className="absolute inset-0 flex flex-col px-6 safe-top safe-bottom overflow-y-auto">
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Workout menu" aria-expanded={menuOpen} className="text-bone-dim py-2 pr-4 -ml-1 text-[26px] leading-none" onClick={() => setMenuOpen((v) => !v)}>
              ‹
            </button>
            <div className="flex items-baseline gap-2">
              <span className="title text-[20px] text-ember">{dayLabel}</span>
              <span className="caption">{dayName}</span>
            </div>
            <span className="caption tabular-nums">
              {liftIdx + 1}/{bundle.lifts.length}
            </span>
          </div>

          {menuOpen && (
            <div className="panel mt-4 py-4">
              <p className="caption mb-4">Your logged sets are saved. Come back today and the workout picks up right here.</p>
              <div className="flex flex-col items-start gap-3.5">
                <Link href="/week" className="link">
                  This week
                </Link>
                <Link href="/history" className="link">
                  History
                </Link>
                <Link href="/settings" className="link">
                  Settings
                </Link>
                <button type="button" className="link text-left" onClick={leaveLift} disabled={busy}>
                  Skip {lift.display_name.toLowerCase()} (counts as a miss)
                </button>
                <button type="button" className="text-bone font-medium" onClick={() => setMenuOpen(false)}>
                  Back to the set
                </button>
              </div>
            </div>
          )}

          <h1 className="title text-[38px] mt-8">{lift.display_name}</h1>
          {lift.formVideoPath && (
            <a href={`/api/form-video/${lift.exercise_key}`} target="_blank" rel="noreferrer" className="link mt-2 self-start text-[15px]">
              Watch form video
            </a>
          )}

          <div className="flex-1 flex flex-col justify-center py-6">
            <div className="caption mb-3">{set.kind === "warmup" ? `Warm-up ${set.set_number} of ${warmups.length}` : `Set ${set.set_number} of ${workSets.length}`}</div>
            <div className="hero text-[124px]">
              <Digits value={`${formatLoad(set.prescribed_weight)} × ${set.prescribed_reps}`} />
            </div>
            <div className="caption mt-2">
              {set.prescribed_weight > 0 ? "lb" : "bodyweight"}, {repsLabel(set.prescribed_reps, set.kind === "work" ? repUnit : null)}
            </div>

            {canAdjust && (
              <div className="flex items-center gap-4 mt-6">
                <button
                  type="button"
                  className="stepper"
                  aria-label="Lighter"
                  onClick={() => changeWeight(-1)}
                  disabled={phase.kind === "saving" || set.prescribed_weight <= MIN_LOAD}
                >
                  −
                </button>
                <button
                  type="button"
                  className="stepper"
                  aria-label="Heavier"
                  onClick={() => changeWeight(1)}
                  disabled={phase.kind === "saving" || set.prescribed_weight >= MAX_LOAD}
                >
                  +
                </button>
                <span className="faint leading-snug">{changed ? `Changed from ${formatLoad(lift.prescribed_weight)} lb. The rest of this lift follows.` : "Change the weight for this set and the rest of this lift."}</span>
              </div>
            )}

            {set.kind === "work" && lift.lastLog && (
              <div className="caption mt-6">
                Last time {formatLoad(lift.lastLog.weight)} × {lift.lastLog.reps}
              </div>
            )}
            {set.kind === "work" && lift.note && <div className={`faint ${lift.lastLog ? "mt-1" : "mt-6"}`}>{lift.note}</div>}

            <div className="flex gap-2 mt-8" aria-label={`Set ${set.kind === "work" ? set.set_number : 0} of ${workSets.length}`}>
              {workSets.map((w) => (
                <span key={w.id} className={`setbar ${w.result === "completed" ? "setbar-done" : w.id === set.id ? "setbar-current" : ""}`} />
              ))}
            </div>
          </div>

          <Pill onClick={logSet} disabled={phase.kind === "saving" || busy}>
            {phase.kind === "saving" ? "Saving…" : set.kind === "warmup" ? "Warm-up done" : "Log set"}
          </Pill>
        </main>
      )}

      {/* ---------------- REST */}
      {phase.kind === "rest" && (
        <main className="absolute inset-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
          <div className="caption mb-8">{phase.logged}</div>
          <RestRing remaining={phase.endsAt - now} total={phase.total} />
          <div className="absolute bottom-0 left-0 right-0 px-6 safe-bottom pb-6 text-center">
            <div className="text-bone-dim">{phase.next}</div>
            <button type="button" onClick={skipRest} className="link faint mt-5">
              Skip rest
            </button>
          </div>
        </main>
      )}

      {/* ---------------- FINISHING / ERROR */}
      {(phase.kind === "finishing" || phase.kind === "error") && (
        <main className="absolute inset-0 flex flex-col items-center justify-center px-6 safe-top safe-bottom">
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

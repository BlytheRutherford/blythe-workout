import { describe, expect, it } from "vitest";
import {
  applyResult,
  effectiveCeiling,
  EXERCISE_KEYS,
  EXERCISES,
  exerciseByKey,
  hardCap,
  ladderLength,
  specForVariant,
  variantFor,
  VARIANTS,
  exercisesForDay,
  formatLoad,
  HARD_CAP_BONUS,
  isLegal,
  LEGAL_LOADS,
  liftResultFromSets,
  MAX_LOAD,
  nextLegal,
  NOTE_DELOAD,
  NOTE_DUMBBELL_MAX,
  prevLegal,
  snapToLegal,
  startingState,
  warmupSets,
  type ExerciseSpec,
  type ExerciseState,
} from "../lib/engine";

const spec: ExerciseSpec = { key: "incline-db-press", rangeMin: 8, rangeMax: 12, isBodyweight: false };
const bw: ExerciseSpec = { key: "pull-up", rangeMin: 8, rangeMax: 12, isBodyweight: true };

const st = (weight: number, targetReps: number, extra: Partial<ExerciseState> = {}): ExerciseState => ({
  weight,
  targetReps,
  consecutiveHits: 0,
  consecutiveMisses: 0,
  variantIndex: 0,
  note: null,
  ...extra,
});

describe("legal loads", () => {
  it("never contains 27.5 or 32.5", () => {
    expect(LEGAL_LOADS).not.toContain(27.5);
    expect(LEGAL_LOADS).not.toContain(32.5);
    expect(isLegal(27.5)).toBe(false);
  });
  it("snaps illegal loads to the next legal load", () => {
    expect(snapToLegal(27.5)).toBe(30);
    expect(snapToLegal(32.5)).toBe(35);
    expect(snapToLegal(26)).toBe(30);
    expect(snapToLegal(27.5, "down")).toBe(25);
    expect(snapToLegal(3)).toBe(5);
    expect(snapToLegal(80)).toBe(52.5);
    expect(snapToLegal(40)).toBe(40);
  });
  it("steps up and down the dial", () => {
    expect(nextLegal(25)).toBe(30);
    expect(nextLegal(50)).toBe(52.5);
    expect(nextLegal(52.5)).toBe(52.5);
    expect(prevLegal(30)).toBe(25);
    expect(prevLegal(5)).toBe(5);
  });
  it("formats loads", () => {
    expect(formatLoad(7.5)).toBe("7.5");
    expect(formatLoad(40)).toBe("40");
    expect(formatLoad(0)).toBe("BW");
  });
});

describe("double progression", () => {
  it("graduates reps: all 3 hit below max → same weight, +1 rep", () => {
    const next = applyResult(st(40, 8), spec, "hit");
    expect(next).toMatchObject({ weight: 40, targetReps: 9, consecutiveMisses: 0 });
  });
  it("graduates load: all 3 hit at max → next legal, reps reset to min", () => {
    const next = applyResult(st(45, 12), spec, "hit");
    expect(next).toMatchObject({ weight: 50, targetReps: 8 });
  });
  it("never lands on 27.5 or 32.5 when graduating", () => {
    expect(applyResult(st(25, 16), spec, "hit").weight).toBe(30);
    expect(applyResult(st(30, 15), spec, "hit").weight).toBe(35);
  });
  it("raises the ceiling when the next dumbbell jump is large", () => {
    expect(effectiveCeiling(45, spec)).toBe(12); // 11 % jump
    expect(effectiveCeiling(25, spec)).toBe(16); // 20 % jump
    expect(effectiveCeiling(10, spec)).toBe(18); // 25 % jump
    expect(effectiveCeiling(7.5, spec)).toBe(20); // 33 % jump, clamped
    expect(effectiveCeiling(5, spec)).toBe(spec.rangeMax + HARD_CAP_BONUS);
    // graduating from 25 lands at ~equal difficulty (Epley): 25×16 ≈ 30×8
    const next = applyResult(st(25, 16), spec, "hit");
    expect(next).toMatchObject({ weight: 30, targetReps: 8 });
    // and 25×12 is not yet a graduation
    expect(applyResult(st(25, 12), spec, "hit")).toMatchObject({ weight: 25, targetReps: 13 });
  });
  it("52.5 at cap stays there and adds bonus reps with a note", () => {
    const next = applyResult(st(52.5, 12), spec, "hit");
    expect(next).toMatchObject({ weight: MAX_LOAD, targetReps: 13, note: NOTE_DUMBBELL_MAX });
    // and once the bonus reps are spent it graduates rather than dead-ending
    const graduated = applyResult(st(52.5, 20), specForVariant("incline-db-press", 0), "hit");
    expect(graduated.variantIndex).toBe(1);
    expect(graduated.weight).toBe(variantFor("incline-db-press", 1).startWeight);
  });
  it("bodyweight lifts progress by reps only", () => {
    expect(applyResult(st(0, 8), bw, "hit")).toMatchObject({ weight: 0, targetReps: 9 });
    expect(applyResult(st(0, 12), bw, "hit")).toMatchObject({ weight: 0, targetReps: 13 });
  });
});

describe("misses", () => {
  it("holds once on a miss", () => {
    const next = applyResult(st(40, 9), spec, "miss");
    expect(next).toMatchObject({ weight: 40, targetReps: 9, consecutiveMisses: 1 });
  });
  it("deloads one increment and resets reps after two straight misses", () => {
    const held = applyResult(st(40, 9), spec, "miss");
    const next = applyResult(held, spec, "miss");
    expect(next).toMatchObject({ weight: 35, targetReps: 8, consecutiveMisses: 0, note: NOTE_DELOAD });
  });
  it("never prescribes the same weight×reps a third time", () => {
    let s = st(30, 10);
    const seen = new Map<string, number>();
    const results = ["miss", "miss", "hit", "miss", "hit", "hit", "miss", "miss", "miss", "hit"] as const;
    for (const r of results) {
      const k = `${s.weight}x${s.targetReps}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      s = applyResult(s, spec, r);
    }
    for (const [, n] of seen) expect(n).toBeLessThanOrEqual(2);
  });
  it("deload never goes below 5 lb and a hit resets the miss counter", () => {
    const a = applyResult(st(5, 8, { consecutiveMisses: 1 }), spec, "miss");
    expect(a.weight).toBe(5);
    const b = applyResult(st(30, 8, { consecutiveMisses: 1 }), spec, "hit");
    expect(b.consecutiveMisses).toBe(0);
  });
});

describe("warm-up", () => {
  it("is ignored when computing a lift result", () => {
    expect(
      liftResultFromSets([
        { kind: "warmup", result: "pending" },
        { kind: "warmup", result: "missed" },
        { kind: "work", result: "completed" },
        { kind: "work", result: "completed" },
        { kind: "work", result: "completed" },
      ]),
    ).toBe("hit");
    expect(
      liftResultFromSets([
        { kind: "warmup", result: "completed" },
        { kind: "work", result: "completed" },
        { kind: "work", result: "pending" },
        { kind: "work", result: "pending" },
      ]),
    ).toBe("miss");
    expect(
      liftResultFromSets([
        { kind: "warmup", result: "completed" },
        { kind: "work", result: "pending" },
        { kind: "work", result: "pending" },
        { kind: "work", result: "pending" },
      ]),
    ).toBe("not_started");
  });
  it("uses legal loads at ~50 % and ~75 %, min 5 lb", () => {
    expect(warmupSets(40, 8, spec)).toEqual([
      { weight: 20, reps: 5 },
      { weight: 30, reps: 3 },
    ]);
    expect(warmupSets(10, 8, spec)).toEqual([
      { weight: 5, reps: 5 },
      { weight: 7.5, reps: 3 },
    ]);
    expect(warmupSets(5, 8, spec)).toEqual([{ weight: 5, reps: 5 }]);
    expect(warmupSets(0, 8, bw)).toEqual([{ weight: 0, reps: 4 }]);
  });
});

describe("starting loads", () => {
  const incline = EXERCISES.find((e) => e.key === "incline-db-press")!;
  it("trained gets the seed", () => {
    expect(startingState(incline, "trained").weight).toBe(40);
  });
  it("non-trained never starts above 40 and snaps down to legal", () => {
    expect(startingState(incline, "sedentary").weight).toBe(17.5);
    expect(startingState(incline, "lightly_active").weight).toBe(20); // 22 → 20
    expect(startingState(incline, "moderately_active").weight).toBe(25);
    expect(startingState({ seedWeight: 52.5, seedReps: 8, isBodyweight: false, rangeMin: 8 }, "moderately_active").weight).toBe(35);
    expect(startingState({ seedWeight: 52.5, seedReps: 8, isBodyweight: false, rangeMin: 8 }, "returning_lifter", 200).weight).toBe(40);
  });
  it("returning lifter scales the seed by bodyweight", () => {
    expect(startingState(incline, "returning_lifter", 160).weight).toBe(30); // 34 → 30
    expect(startingState(incline, "returning_lifter", 200).weight).toBe(40); // 42.5 → 40
    expect(startingState(incline, "returning_lifter", 110).weight).toBe(25); // 27.2 → 25
  });
  it("every seed and starting load is legal", () => {
    for (const e of EXERCISES) {
      if (e.isBodyweight) continue;
      expect(isLegal(e.seedWeight)).toBe(true);
      for (const a of ["sedentary", "lightly_active", "moderately_active", "returning_lifter", "trained"] as const) {
        expect(isLegal(startingState(e, a, 150).weight)).toBe(true);
      }
    }
  });
});

describe("program", () => {
  it("has six lifts on each of five days", () => {
    for (let d = 1; d <= 5; d++) expect(exercisesForDay(d)).toHaveLength(6);
    expect(new Set(EXERCISES.map((e) => e.slug)).size).toBe(30);
  });
  it("gives every slot a ladder whose first rung matches the slot", () => {
    for (const e of EXERCISES) {
      const v = variantFor(e.key, 0);
      expect(v.name).toBe(e.name);
      expect(v.startWeight).toBe(e.seedWeight);
      expect(v.isBodyweight).toBe(e.isBodyweight);
      expect(v.rangeMin).toBe(e.rangeMin);
      expect(v.rangeMax).toBe(e.rangeMax);
    }
  });
  it("uses only legal loads on every rung of every ladder", () => {
    for (const [key, ladder] of Object.entries(VARIANTS)) {
      expect(ladder.length).toBeGreaterThan(0);
      for (const v of ladder) {
        if (v.isBodyweight) expect(v.startWeight).toBe(0);
        else expect(isLegal(v.startWeight)).toBe(true);
        expect(v.rangeMin).toBeLessThanOrEqual(v.rangeMax);
        expect(v.emailName.length).toBeGreaterThan(0);
      }
      expect(ladderLength(key)).toBe(ladder.length);
    }
  });
  it("covers every progression key with a ladder", () => {
    for (const k of EXERCISE_KEYS) expect(VARIANTS[k]).toBeDefined();
  });
});

describe("graduating past the 52.5 lb ceiling", () => {
  const spec = specForVariant("goblet-squat", 0);

  it("spends the bonus reps at 52.5 before changing anything", () => {
    const next = applyResult(st(52.5, 12, { variantIndex: 0 }), spec, "hit");
    expect(next).toMatchObject({ weight: 52.5, targetReps: 13, variantIndex: 0, note: NOTE_DUMBBELL_MAX });
  });

  it("moves to the next movement once 52.5 × the rep cap is beaten", () => {
    const next = applyResult(st(52.5, hardCap(spec), { variantIndex: 0 }), spec, "hit");
    expect(next.variantIndex).toBe(1);
    expect(next.weight).toBe(variantFor("goblet-squat", 1).startWeight);
    expect(next.targetReps).toBe(variantFor("goblet-squat", 1).rangeMin);
    expect(next.consecutiveHits).toBe(0);
    expect(next.note).toBeTruthy();
  });

  it("carries a bodyweight lift onto a loaded rung and back again", () => {
    const bwSpec = specForVariant("pull-up", 0);
    const graduated = applyResult(st(0, hardCap(bwSpec), { variantIndex: 0 }), bwSpec, "hit");
    expect(graduated.variantIndex).toBe(1);
    expect(graduated.weight).toBe(10); // weighted pull-up, DB between the feet
    const tri = specForVariant("overhead-db-extension", 1);
    const toBodyweight = applyResult(st(52.5, hardCap(tri), { variantIndex: 1 }), tri, "hit");
    expect(toBodyweight.variantIndex).toBe(2);
    expect(toBodyweight.weight).toBe(0);
  });

  it("stops at the top of the ladder instead of looping", () => {
    const last = ladderLength("lateral-raise") - 1;
    const spec2 = specForVariant("lateral-raise", last);
    const next = applyResult(st(52.5, hardCap(spec2), { variantIndex: last }), spec2, "hit");
    expect(next.variantIndex).toBe(last);
    expect(next.targetReps).toBe(hardCap(spec2));
  });

  it("walks a whole ladder to the top without emitting an illegal load", () => {
    const key = "db-rdl";
    let s = { ...startingState(exerciseByKey(key)!, "trained"), variantIndex: 0 };
    const seen: string[] = [];
    for (let i = 0; i < 400; i++) {
      const sp = specForVariant(key, s.variantIndex);
      if (!sp.isBodyweight) expect(isLegal(s.weight)).toBe(true);
      seen.push(`${s.variantIndex}:${s.weight}x${s.targetReps}`);
      s = applyResult(s, sp, "hit");
    }
    expect(s.variantIndex).toBe(ladderLength(key) - 1);
    expect(new Set(seen).size).toBeGreaterThan(50);
  });
});

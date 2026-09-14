/**
 * Legal Bowflex SelectTech 552 loads (lb, per dumbbell).
 * 27.5 and 32.5 do not exist on the dial and are never emitted.
 */
export const LEGAL_LOADS: readonly number[] = [
  5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 52.5,
] as const;

export const MIN_LOAD = LEGAL_LOADS[0];
export const MAX_LOAD = LEGAL_LOADS[LEGAL_LOADS.length - 1];

export function isLegal(w: number): boolean {
  return LEGAL_LOADS.includes(w);
}

/**
 * Snap any number to a legal load.
 * "up"   → smallest legal load ≥ w (default: the spec says snap to the *next* legal).
 * "down" → largest legal load ≤ w (used for conservative starting loads).
 * "nearest" → closest, ties go up.
 * Always clamps to [5, 52.5].
 */
export function snapToLegal(w: number, dir: "up" | "down" | "nearest" = "up"): number {
  if (!Number.isFinite(w)) return MIN_LOAD;
  if (w <= MIN_LOAD) return MIN_LOAD;
  if (w >= MAX_LOAD) return MAX_LOAD;
  if (isLegal(w)) return w;
  const above = LEGAL_LOADS.find((l) => l > w) as number;
  const below = [...LEGAL_LOADS].reverse().find((l) => l < w) as number;
  if (dir === "up") return above;
  if (dir === "down") return below;
  return above - w <= w - below ? above : below;
}

/** Next legal load above w, or w itself when already at the 52.5 cap. */
export function nextLegal(w: number): number {
  const cur = snapToLegal(w, "up");
  const i = LEGAL_LOADS.indexOf(cur);
  return i < 0 || i === LEGAL_LOADS.length - 1 ? MAX_LOAD : LEGAL_LOADS[i + 1];
}

/** Previous legal load below w, or 5 when already at the floor. */
export function prevLegal(w: number): number {
  const cur = snapToLegal(w, "down");
  const i = LEGAL_LOADS.indexOf(cur);
  return i <= 0 ? MIN_LOAD : LEGAL_LOADS[i - 1];
}

/** Percent jump from w to the next legal load (0 at the cap). */
export function nextJumpPercent(w: number): number {
  const cur = snapToLegal(w, "up");
  if (cur >= MAX_LOAD) return 0;
  return ((nextLegal(cur) - cur) / cur) * 100;
}

/** Format a load for display: 7.5 → "7.5", 40 → "40", 0 → "BW". */
export function formatLoad(w: number): string {
  if (w <= 0) return "BW";
  return Number.isInteger(w) ? String(w) : w.toFixed(1);
}

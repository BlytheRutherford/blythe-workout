"use client";

/** Keeps the screen on during a workout (sets and rest timers). Best-effort. */
let sentinel: WakeLockSentinel | null = null;

export async function acquireWakeLock() {
  try {
    if (!("wakeLock" in navigator)) return;
    if (document.visibilityState !== "visible") return;
    if (sentinel && !sentinel.released) return;
    sentinel = await navigator.wakeLock.request("screen");
  } catch {
    sentinel = null;
  }
}

export async function releaseWakeLock() {
  try {
    await sentinel?.release();
  } catch {}
  sentinel = null;
}

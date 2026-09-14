"use client";

import { useEffect } from "react";

/** Registers the service worker (app-shell cache) in production. */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* offline shell is a nicety, never a blocker */
    });
  }, []);
  return null;
}

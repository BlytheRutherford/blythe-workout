"use client";

import { useEffect, useState } from "react";

/**
 * The daily 2-mile walk is outside the app. This is only a gray note.
 * Before a session exists it remembers locally; once a session exists it's stored with it.
 */
export function WalkNote({ sessionId, done: initial }: { sessionId: string | null; done: boolean }) {
  const [done, setDone] = useState(initial);
  const key = `walk-${new Date().toDateString()}`;

  useEffect(() => {
    if (!sessionId) {
      try {
        if (localStorage.getItem(key) === "1") setTimeout(() => setDone(true), 0);
      } catch {}
    }
  }, [sessionId, key]);

  async function toggle() {
    const next = !done;
    setDone(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {}
    if (sessionId) {
      await fetch(`/api/session/${sessionId}/walk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: next }),
      }).catch(() => {});
    }
  }

  return (
    <button type="button" onClick={toggle} className="faint text-left mt-4 py-2">
      {done ? "Walk already done." : "2-mile walk · outside the app · tap when done"}
    </button>
  );
}

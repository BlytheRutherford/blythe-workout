"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pill } from "@/components/ui";

export function StartWorkout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start.");
      router.push(`/workout/${json.sessionId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <p className="caption mb-3">{error}</p>}
      <Pill onClick={start} disabled={busy}>
        {busy ? "Starting…" : "Start workout"}
      </Pill>
    </div>
  );
}

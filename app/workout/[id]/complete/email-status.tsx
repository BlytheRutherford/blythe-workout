"use client";

import { useEffect, useState } from "react";
import { PillLink } from "@/components/ui";

type Status = "pending" | "stitching" | "sent" | "failed";

export function EmailStatus({ sessionId, initialStatus, dayNumber, to }: { sessionId: string; initialStatus: Status; dayNumber: number; to: string | null }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (status === "sent" || status === "failed") return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}/status`, { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (!stop) {
            setStatus(j.email_status);
            setError(j.email_error ?? null);
          }
        }
      } catch {}
      if (!stop) setTimeout(tick, 5000);
    };
    const t = setTimeout(tick, 4000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [status, sessionId]);

  async function retry() {
    setRetrying(true);
    try {
      await fetch(`/api/session/${sessionId}/retry-email`, { method: "POST" });
      setStatus("pending");
      setError(null);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <div className="mt-6 min-h-12">
        {status === "sent" && <p className="caption">Emailed: Day {dayNumber} of Blythe Workouts{to ? ` · ${to}` : ""}</p>}
        {(status === "pending" || status === "stitching") && <p className="caption">Stitching your video and emailing Day {dayNumber} of Blythe Workouts…</p>}
        {status === "failed" && (
          <div>
            <p className="caption">Email failed{error ? ` · ${error}` : ""}.</p>
            <button type="button" className="link mt-2" onClick={retry} disabled={retrying}>
              {retrying ? "Retrying…" : "Retry email"}
            </button>
          </div>
        )}
      </div>
      <div className="flex-1" />
      <PillLink href="/today">Done</PillLink>
    </>
  );
}

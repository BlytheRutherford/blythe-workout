"use client";

import { useEffect, useState } from "react";
import { PillLink } from "@/components/ui";

type EmailStatus = "pending" | "stitching" | "sent" | "failed";

interface LiftItem {
  id: string;
  name: string;
  load: string;
  status: "pending" | "in_progress" | "completed" | "missed";
  emailStatus: EmailStatus;
  emailError: string | null;
  emailSubject: string | null;
}

/** Hairline log of the day; each completed lift shows the state of its "Day N: <lift>" email. */
export function LiftEmails({ sessionId, dayNumber, recordsVideo, lifts: initial }: { sessionId: string; dayNumber: number; recordsVideo: boolean; lifts: LiftItem[] }) {
  const [lifts, setLifts] = useState(initial);
  const [retrying, setRetrying] = useState<string | null>(null);

  const unsettled = recordsVideo && lifts.some((l) => l.status === "completed" && (l.emailStatus === "pending" || l.emailStatus === "stitching"));

  useEffect(() => {
    if (!unsettled) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}/status`, { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (!stop && Array.isArray(j.lifts)) {
            setLifts((cur) =>
              cur.map((l) => {
                const u = j.lifts.find((x: { id: string }) => x.id === l.id);
                return u ? { ...l, emailStatus: u.email_status, emailError: u.email_error ?? null, emailSubject: u.email_subject ?? l.emailSubject } : l;
              }),
            );
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
  }, [unsettled, sessionId]);

  async function retry(liftId: string) {
    setRetrying(liftId);
    try {
      await fetch(`/api/session/${sessionId}/lift/${liftId}/retry-email`, { method: "POST" });
      setLifts((cur) => cur.map((l) => (l.id === liftId ? { ...l, emailStatus: "pending", emailError: null } : l)));
    } finally {
      setRetrying(null);
    }
  }

  const sentCount = lifts.filter((l) => l.emailStatus === "sent" && l.status === "completed").length;
  const doneCount = lifts.filter((l) => l.status === "completed").length;

  return (
    <>
      <ul>
        {lifts.map((l) => (
          <li key={l.id} className="py-3 border-b hairline">
            <div className="flex items-baseline justify-between gap-4">
              <span className={l.status === "completed" ? "text-text" : "text-text-faint"}>{l.name}</span>
              <span className="caption whitespace-nowrap">
                {l.load}
                {l.status === "missed" ? " · missed" : ""}
              </span>
            </div>
            {recordsVideo && l.status === "completed" && (
              <div className="faint mt-1">
                {l.emailStatus === "sent" && `Emailed: ${l.emailSubject ?? `Day ${dayNumber}: ${l.name}`}`}
                {(l.emailStatus === "pending" || l.emailStatus === "stitching") && "Stitching sets and emailing…"}
                {l.emailStatus === "failed" && (
                  <>
                    Email failed{l.emailError ? ` · ${l.emailError}` : ""}.{" "}
                    <button type="button" className="link" onClick={() => retry(l.id)} disabled={retrying === l.id}>
                      {retrying === l.id ? "Retrying…" : "Retry"}
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {recordsVideo && (
        <p className="caption mt-6">
          {sentCount} of {doneCount} lift{doneCount === 1 ? "" : "s"} emailed
        </p>
      )}
      <div className="flex-1" />
      <PillLink href="/today">Done</PillLink>
    </>
  );
}

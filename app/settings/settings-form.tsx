"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pill } from "@/components/ui";

export function SettingsForm({ email }: { email: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resetProgress() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/reset", { method: "POST" });
    if (res.ok) {
      setConfirmReset(false);
      setSaved(true);
      router.refresh();
    } else {
      setError("Could not reset.");
    }
    setBusy(false);
  }

  async function deleteAccount() {
    setBusy(true);
    const res = await fetch("/api/account/delete", { method: "POST" });
    if (res.ok) {
      router.replace("/sign-in");
      router.refresh();
    } else {
      setError("Could not delete the account.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="panel">
        <div className="hairline-row">
          <span className="caption">Account</span>
          <span className="caption truncate">{email}</span>
        </div>

        <a href="/api/export/csv" className="hairline-row text-bone">
          <span>Export CSV</span>
          <span className="caption">Every set you&rsquo;ve logged</span>
        </a>

        <form action="/auth/sign-out" method="post" className="hairline-row">
          <button type="submit" className="text-bone text-left">
            Log out
          </button>
        </form>
      </div>

      <div className="panel mt-4">
        {!confirmReset ? (
          <button type="button" className="hairline-row text-left w-full" onClick={() => setConfirmReset(true)}>
            <span className="text-bone">Reset all exercises</span>
            <span className="caption">Start over at Day 1</span>
          </button>
        ) : (
          <div className="py-4 border-b hairline">
            <p className="caption mb-4">
              This deletes every logged workout and set and puts every lift back to its starting weight. Your account stays.
            </p>
            <Pill onClick={resetProgress} disabled={busy}>
              {busy ? "Resetting…" : "Reset everything"}
            </Pill>
            <button type="button" className="link mt-4" onClick={() => setConfirmReset(false)}>
              Keep my progress
            </button>
          </div>
        )}

        {!confirmDelete ? (
          <button type="button" className="hairline-row text-left w-full" onClick={() => setConfirmDelete(true)}>
            <span className="text-bone-dim">Delete account</span>
          </button>
        ) : (
          <div className="py-4">
            <p className="caption mb-4">This deletes your account and every log. There is no undo.</p>
            <Pill onClick={deleteAccount} disabled={busy}>
              {busy ? "Deleting…" : "Delete my account"}
            </Pill>
            <button type="button" className="link mt-4" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        )}
      </div>

      {(saved || error) && <p className="caption mt-4">{error ?? "Done. Every lift is back to its starting weight."}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, Pill } from "@/components/ui";

interface Props {
  email: string;
  deliveryEmail: string;
  burnOverlay: boolean;
  recordsVideo: boolean;
  recordAudio: boolean;
  calibrationDaysLeft: number;
}

export function SettingsForm({ email, deliveryEmail: initialDelivery, burnOverlay: initialBurn, recordsVideo, recordAudio: initialAudio, calibrationDaysLeft }: Props) {
  const router = useRouter();
  const [delivery, setDelivery] = useState(initialDelivery);
  const [burn, setBurn] = useState(initialBurn);
  const [audio, setAudio] = useState(initialAudio);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { deliveryEmail?: string; burnOverlay?: boolean; recordAudio?: boolean }) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Could not save.");
    else setSaved(true);
    setBusy(false);
  }

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
      <div className="hairline-row">
        <span className="caption">Account</span>
        <span className="caption">{email}</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ deliveryEmail: delivery.trim() });
        }}
        className="border-b hairline py-3"
      >
        <label className="caption block">Delivery email</label>
        <Field type="email" placeholder={email} value={delivery} onChange={(e) => setDelivery(e.target.value)} className="field !border-0 !py-1" />
        <div className="flex items-center justify-between mt-1">
          <span className="faint">Lift videos go here. Blank uses your account email.</span>
          <button type="submit" className="link" disabled={busy}>
            Save
          </button>
        </div>
      </form>

      <div className="hairline-row">
        <span className="caption">Calibration</span>
        <span className="caption">{calibrationDaysLeft > 0 ? `${calibrationDaysLeft} day${calibrationDaysLeft === 1 ? "" : "s"} left` : "closed"}</span>
      </div>

      {recordsVideo && (
        <>
          <button
            type="button"
            className="hairline-row text-left w-full"
            onClick={() => {
              const next = !burn;
              setBurn(next);
              save({ burnOverlay: next });
            }}
          >
            <span className="caption">Burn weight × reps into video</span>
            <span className="caption">{burn ? "on" : "off"}</span>
          </button>
          <button
            type="button"
            className="hairline-row text-left w-full"
            onClick={() => {
              const next = !audio;
              setAudio(next);
              save({ recordAudio: next });
            }}
          >
            <span className="caption">Record microphone</span>
            <span className="caption">{audio ? "on · pauses background music" : "off · music keeps playing"}</span>
          </button>
        </>
      )}

      <a href="/api/export/csv" className="hairline-row text-text">
        <span>Export CSV</span>
        <span className="caption">every set</span>
      </a>

      <form action="/auth/sign-out" method="post" className="hairline-row">
        <button type="submit" className="text-text text-left">
          Log out
        </button>
      </form>

      {!confirmReset ? (
        <button type="button" className="hairline-row text-left w-full" onClick={() => setConfirmReset(true)}>
          <span className="text-text">Reset all exercises</span>
          <span className="caption">start over at Day 1</span>
        </button>
      ) : (
        <div className="py-4 border-b hairline">
          <p className="caption mb-4">
            This deletes every logged day, set and video, puts every lift back to its starting weight, and reopens the two-week
            calibration. Your account stays.
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
          <span className="text-text-dim">Delete account</span>
        </button>
      ) : (
        <div className="py-4 border-b hairline">
          <p className="caption mb-4">This deletes your account, every log and every video. There is no undo.</p>
          <Pill onClick={deleteAccount} disabled={busy}>
            {busy ? "Deleting…" : "Delete my account"}
          </Pill>
          <button type="button" className="link mt-4" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </div>
      )}

      {(saved || error) && <p className="caption mt-4">{error ?? "Saved."}</p>}
    </div>
  );
}

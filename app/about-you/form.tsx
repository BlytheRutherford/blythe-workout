"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, Pill, Screen, Select, Title, Wordmark } from "@/components/ui";
import { ACTIVITY_LEVELS } from "@/lib/engine";

export function AboutYouForm() {
  const router = useRouter();
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ft = Number(feet);
    const inch = Number(inches || 0);
    const lb = Number(weight);
    if (!ft || ft < 3 || ft > 8) return setError("Height in feet, please.");
    if (inch < 0 || inch > 11) return setError("Inches between 0 and 11.");
    if (!lb || lb < 60 || lb > 500) return setError("Weight in pounds, please.");
    if (!activity) return setError("Pick an activity level.");
    setBusy(true);
    const heightCm = Math.round((ft * 12 + inch) * 2.54 * 10) / 10;
    const res = await fetch("/api/profile/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heightCm, weightLb: lb, activity }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Could not save.");
      setBusy(false);
      return;
    }
    router.replace("/today");
    router.refresh();
  }

  return (
    <Screen className="justify-center">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Wordmark className="mb-8" />
        <Title className="mb-6">About you</Title>
        <div className="flex gap-6">
          <Field type="number" inputMode="numeric" placeholder="Height · ft" min={3} max={8} value={feet} onChange={(e) => setFeet(e.target.value)} />
          <Field type="number" inputMode="numeric" placeholder="in" min={0} max={11} value={inches} onChange={(e) => setInches(e.target.value)} />
        </div>
        <Field type="number" inputMode="decimal" placeholder="Weight · lb" min={60} max={500} value={weight} onChange={(e) => setWeight(e.target.value)} />
        <Select value={activity} onChange={(e) => setActivity(e.target.value)} required>
          <option value="" disabled>
            Activity level
          </option>
          {ACTIVITY_LEVELS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
        <p className="faint mt-3">Sets your starting weights. You can change the weight on any set while you train.</p>
        {error && <p className="caption mt-2">{error}</p>}
        <Pill type="submit" className="mt-8" disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </Pill>
      </form>
    </Screen>
  );
}

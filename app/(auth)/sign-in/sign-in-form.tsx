"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, Pill, Screen, Wordmark } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Read ?notice= on the client so the form itself is prerendered (no Suspense bail-out).
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("notice");
    if (n) setTimeout(() => setNotice(n), 0);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      setBusy(false);
      return;
    }
    router.replace("/today");
    router.refresh();
  }

  return (
    <Screen className="justify-center">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Wordmark className="mb-10" />
        {notice === "confirm" && <p className="caption mb-4">Check your email to confirm your account, then sign in.</p>}
        {notice === "reset-sent" && <p className="caption mb-4">Reset link sent. Check your email.</p>}
        {notice === "password-updated" && <p className="caption mb-4">Password updated. Sign in.</p>}
        {notice === "link-invalid" && <p className="caption mb-4">That link has expired. Request a new one.</p>}
        <Field
          type="email"
          name="email"
          placeholder="Email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="caption mt-2">{error}</p>}
        <Pill type="submit" className="mt-8" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Pill>
        <div className="flex justify-between mt-6">
          <Link href="/create-account" className="link">
            Create account
          </Link>
          <Link href="/reset-password" className="link">
            Reset password
          </Link>
        </div>
      </form>
    </Screen>
  );
}

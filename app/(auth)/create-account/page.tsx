"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, Pill, Screen, Wordmark } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function CreateAccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password needs at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/about-you` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // Email confirmation on: no session until the link is tapped.
    if (!data.session) {
      router.replace("/sign-in?notice=confirm");
      return;
    }
    router.replace("/about-you");
    router.refresh();
  }

  return (
    <Screen className="justify-center">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Wordmark className="mb-10" />
        <Field
          type="email"
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
          placeholder="Password (8+ characters)"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="caption mt-2">{error}</p>}
        <Pill type="submit" className="mt-8" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Pill>
        <div className="flex justify-between mt-6">
          <Link href="/sign-in" className="link">
            Sign in
          </Link>
        </div>
      </form>
    </Screen>
  );
}

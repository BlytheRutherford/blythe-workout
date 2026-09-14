"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, Pill, Screen, Wordmark } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.replace("/sign-in?notice=reset-sent");
  }

  return (
    <Screen className="justify-center">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Wordmark className="mb-10" />
        <p className="caption mb-4">We&rsquo;ll email you a link to set a new password.</p>
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
        {error && <p className="caption mt-2">{error}</p>}
        <Pill type="submit" className="mt-8" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </Pill>
        <div className="flex justify-between mt-6">
          <Link href="/sign-in" className="link">
            Back to sign in
          </Link>
        </div>
      </form>
    </Screen>
  );
}

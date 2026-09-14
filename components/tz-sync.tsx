"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps a `tz` cookie in sync with the device so the server renders the right calendar day. */
export function TzSync({ current }: { current: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === current) return;
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [current, router]);
  return null;
}

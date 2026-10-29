import { cookies } from "next/headers";
import Link from "next/link";
import { DEFAULT_TZ, isValidTz, localDay } from "@/lib/session/dates";
import { createClient, currentUser } from "@/lib/supabase/server";

/**
 * Slim bar on Today / Week / History / Settings while a workout is open, so
 * stepping off the live screen mid-workout is never a dead end.
 */
export async function ResumeBar() {
  const user = await currentUser();
  if (!user) return null;
  const db = await createClient();
  const cookieStore = await cookies();
  const tzCookie = cookieStore.get("tz")?.value ?? null;
  const today = localDay(isValidTz(tzCookie) ? tzCookie : DEFAULT_TZ);
  const { data } = await db
    .from("sessions")
    .select("id")
    .eq("user_id", user.id)
    .eq("session_date", today.ymd)
    .eq("status", "in_progress")
    .maybeSingle();
  if (!data) return null;
  return (
    <Link href={`/workout/${data.id}`} className="flex items-center justify-between rounded-2xl bg-oxblood/70 border border-crimson px-4 py-3 mt-5">
      <span className="text-bone">Workout in progress</span>
      <span className="text-bone font-semibold">Resume</span>
    </Link>
  );
}

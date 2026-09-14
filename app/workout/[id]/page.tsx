import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DAYS } from "@/lib/engine";
import { DEFAULT_TZ, isValidTz, localDay } from "@/lib/session/dates";
import { getProfile, getSessionById } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { Workout } from "./workout";

export const dynamic = "force-dynamic";

export default async function WorkoutPage({ params }: PageProps<"/workout/[id]">) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const [bundle, profile] = await Promise.all([getSessionById(db, user.id, id), getProfile(db, user.id)]);
  if (!bundle || !profile) redirect("/today");
  if (bundle.session.status === "complete") redirect(`/workout/${id}/complete`);
  if (bundle.session.status === "abandoned") redirect("/today");

  const cookieStore = await cookies();
  const tzCookie = cookieStore.get("tz")?.value ?? null;
  const tz = isValidTz(tzCookie) ? tzCookie : DEFAULT_TZ;
  const today = localDay(tz);

  const { count } = await db.from("sessions").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "complete");

  return (
    <Workout
      bundle={bundle}
      userId={user.id}
      dayShort={DAYS[bundle.session.day_index - 1].short}
      dayNumber={(count ?? 0) + 1}
      calibrating={today.ymd <= profile.calibration_ends_on}
      burnOverlay={profile.burn_overlay}
      tz={tz}
    />
  );
}

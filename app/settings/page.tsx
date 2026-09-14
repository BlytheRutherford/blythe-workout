import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, TabBar, Title, Wordmark } from "@/components/ui";
import { DEFAULT_TZ, daysBetween, isValidTz, localDay } from "@/lib/session/dates";
import { getProfile } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect("/sign-in");
  const cookieStore = await cookies();
  const tzCookie = cookieStore.get("tz")?.value ?? null;
  const today = localDay(isValidTz(tzCookie) ? tzCookie : DEFAULT_TZ);
  const daysLeft = Math.max(0, daysBetween(today.ymd, profile.calibration_ends_on) + 1);

  return (
    <>
      <Screen>
        <Wordmark />
        <Title className="mt-10 mb-6">Settings</Title>
        <SettingsForm
          email={profile.email}
          deliveryEmail={profile.delivery_email ?? ""}
          burnOverlay={profile.burn_overlay}
          calibrationDaysLeft={today.ymd <= profile.calibration_ends_on ? daysLeft : 0}
        />
        {profile.role === "admin" && (
          <Link href="/admin/form-videos" className="hairline-row text-text">
            <span>Form videos</span>
            <span className="caption">admin</span>
          </Link>
        )}
      </Screen>
      <TabBar active="settings" />
    </>
  );
}

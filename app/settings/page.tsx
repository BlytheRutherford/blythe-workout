import { redirect } from "next/navigation";
import Link from "next/link";
import { Screen, TabBar, Title, Wordmark } from "@/components/ui";
import { ResumeBar } from "@/components/resume-bar";
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

  return (
    <>
      <Screen>
        <Wordmark />
        <ResumeBar />
        <Title className="mt-10 mb-6">Settings</Title>
        <SettingsForm email={profile.email} />
        {profile.role === "admin" && (
          <Link href="/admin/form-videos" className="panel mt-4 hairline-row !py-4 text-bone">
            <span>Form videos</span>
            <span className="caption">Upload one per exercise</span>
          </Link>
        )}
      </Screen>
      <TabBar active="settings" />
    </>
  );
}

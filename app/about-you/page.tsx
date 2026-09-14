import { redirect } from "next/navigation";
import { getProfile } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { AboutYouForm } from "./form";

export const dynamic = "force-dynamic";

export default async function AboutYouPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const profile = await getProfile(db, user.id);
  if (profile?.onboarded_at) redirect("/today");
  return <AboutYouForm />;
}

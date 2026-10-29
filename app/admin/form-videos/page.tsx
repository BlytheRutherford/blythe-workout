import { redirect } from "next/navigation";
import { Screen, TabBar, Title, Wordmark } from "@/components/ui";
import { EXERCISES } from "@/lib/engine";
import { getProfile } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { FormVideoList } from "./list";

export const dynamic = "force-dynamic";

/** ADMIN_EMAIL only. One form clip per lift, shown as a link on the live screen. */
export default async function FormVideosPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const profile = await getProfile(db, user.id);
  if (!profile || profile.role !== "admin") redirect("/settings");
  const { data: videos } = await db.from("form_videos").select("exercise_key, storage_path, bytes, updated_at");
  const byKey = new Map((videos ?? []).map((v) => [v.exercise_key, v]));
  const seen = new Set<string>();
  const lifts = EXERCISES.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true))).map((e) => ({
    key: e.key,
    name: e.variantRule === "thu-press" ? "Decline / flat DB press (Day 4)" : e.name,
    current: byKey.get(e.key) ? { updatedAt: byKey.get(e.key)!.updated_at as string, bytes: byKey.get(e.key)!.bytes as number | null } : null,
  }));

  return (
    <>
      <Screen>
        <Wordmark />
        <Title className="mt-10 mb-1">Form videos</Title>
        <p className="caption mb-4">One clip per exercise. It shows as a &ldquo;Watch form video&rdquo; link while you do that lift.</p>
        <div className="panel"><FormVideoList lifts={lifts} /></div>
      </Screen>
      <TabBar active="settings" />
    </>
  );
}

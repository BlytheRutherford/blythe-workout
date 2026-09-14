import { redirect } from "next/navigation";
import { Screen, Title, Wordmark } from "@/components/ui";
import { DAYS, formatLoad } from "@/lib/engine";
import { getProfile, getSessionById } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { LiftEmails } from "./lift-emails";

export const dynamic = "force-dynamic";

export default async function CompletePage({ params }: PageProps<"/workout/[id]/complete">) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const [bundle, profile] = await Promise.all([getSessionById(db, user.id, id), getProfile(db, user.id)]);
  if (!bundle) redirect("/today");
  if (bundle.session.status !== "complete") redirect(`/workout/${id}`);
  const s = bundle.session;
  const day = DAYS[s.day_index - 1];

  return (
    <Screen>
      <Wordmark />
      <div className="mt-10 mb-1 flex items-baseline justify-between">
        <Title>Day {s.day_number}</Title>
        <span className="faint">{day.short}</span>
      </div>
      <p className="caption mb-6">{day.name.toLowerCase()} · complete</p>
      <LiftEmails
        sessionId={s.id}
        dayNumber={s.day_number ?? 0}
        recordsVideo={Boolean(profile?.records_video)}
        lifts={bundle.lifts.map((l) => ({
          id: l.id,
          name: l.display_name,
          load: `${formatLoad(l.prescribed_weight)} × ${l.prescribed_reps}${l.exercise.rep_unit ?? ""} × 3`,
          status: l.status,
          emailStatus: l.email_status,
          emailError: l.email_error,
          emailSubject: l.email_subject,
        }))}
      />
    </Screen>
  );
}

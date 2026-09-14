import { redirect } from "next/navigation";
import { Screen, Title, Wordmark } from "@/components/ui";
import { DAYS, formatLoad } from "@/lib/engine";
import { getSessionById } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { EmailStatus } from "./email-status";

export const dynamic = "force-dynamic";

export default async function CompletePage({ params }: PageProps<"/workout/[id]/complete">) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const bundle = await getSessionById(db, user.id, id);
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
      <ul>
        {bundle.lifts.map((l) => (
          <li key={l.id} className="hairline-row">
            <span className={l.status === "completed" ? "text-text" : "text-text-faint"}>{l.display_name}</span>
            <span className="caption whitespace-nowrap">
              {formatLoad(l.prescribed_weight)} × {l.prescribed_reps}
              {l.exercise.rep_unit ?? ""} × 3{l.status === "missed" ? " · missed" : ""}
            </span>
          </li>
        ))}
      </ul>
      <EmailStatus sessionId={s.id} initialStatus={s.email_status} dayNumber={s.day_number ?? 0} to={s.email_to} />
    </Screen>
  );
}

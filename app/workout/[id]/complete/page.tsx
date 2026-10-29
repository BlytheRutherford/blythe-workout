import { redirect } from "next/navigation";
import { PillLink, Screen, Wordmark } from "@/components/ui";
import { DAYS, formatSetWeights } from "@/lib/engine";
import { getSessionById } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";

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
  const done = bundle.lifts.filter((l) => l.status === "completed").length;

  return (
    <Screen>
      <Wordmark />
      <div className="mt-12 mb-6">
        <div className="title text-[76px] text-ember leading-[0.82]">
          {day.label} <span className="text-bone">done</span>
        </div>
        <div className="title text-[30px] mt-2">{day.name}</div>
        <p className="caption mt-3">
          Workout {s.day_number}. {done} of {bundle.lifts.length} lifts finished.
        </p>
      </div>
      <ul className="panel">
        {bundle.lifts.map((l) => {
          const weights = l.sets.filter((x) => x.kind === "work" && x.result === "completed").map((x) => x.actual_weight ?? x.prescribed_weight);
          return (
            <li key={l.id} className="hairline-row">
              <span className={l.status === "completed" ? "text-bone" : "text-bone-faint"}>{l.display_name}</span>
              <span className="caption whitespace-nowrap">
                {l.status === "missed" && weights.length === 0
                  ? "skipped"
                  : formatSetWeights(l.exercise.is_bodyweight ? [0] : weights.length ? weights : [l.prescribed_weight], l.prescribed_reps, l.exercise.rep_unit)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex-1 min-h-8" />
      <PillLink href="/today">Done</PillLink>
    </Screen>
  );
}

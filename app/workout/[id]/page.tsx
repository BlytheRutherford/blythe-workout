import { redirect } from "next/navigation";
import { DAYS } from "@/lib/engine";
import { getSessionById } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { Workout } from "./workout";

export const dynamic = "force-dynamic";

export default async function WorkoutPage({ params }: PageProps<"/workout/[id]">) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const bundle = await getSessionById(db, user.id, id);
  if (!bundle) redirect("/today");
  if (bundle.session.status === "complete") redirect(`/workout/${id}/complete`);
  if (bundle.session.status === "abandoned") redirect("/today");
  const day = DAYS[bundle.session.day_index - 1];

  return <Workout bundle={bundle} dayLabel={day.label} dayName={day.name} />;
}

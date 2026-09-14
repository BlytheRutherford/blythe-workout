import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PillLink, Screen, TabBar, Title, Wordmark } from "@/components/ui";
import { TzSync } from "@/components/tz-sync";
import { DAYS, formatLoad } from "@/lib/engine";
import { DEFAULT_TZ, isValidTz, localDay } from "@/lib/session/dates";
import { previewToday } from "@/lib/session/preview";
import { finalizeStaleSessions, getProfile, getSessionForDate } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { StartWorkout } from "./start-workout";
import { WalkNote } from "./walk-note";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect("/sign-in");
  if (!profile.onboarded_at) redirect("/about-you");

  const cookieStore = await cookies();
  const tzCookie = cookieStore.get("tz")?.value ?? null;
  const tz = isValidTz(tzCookie) ? tzCookie : DEFAULT_TZ;
  const day = localDay(tz);

  await finalizeStaleSessions(db, user.id, day.ymd);

  if (day.dayIndex === 0) {
    return (
      <>
        <Screen>
          <TzSync current={tzCookie} />
          <Wordmark />
          <div className="flex-1 flex flex-col justify-center gap-4">
            <Title className="text-[28px]">Yoga day</Title>
            <p className="caption">Yoga With Adriene</p>
            <p className="faint">No lift prescribed.</p>
          </div>
        </Screen>
        <TabBar active="today" />
      </>
    );
  }

  const dayDef = DAYS[day.dayIndex - 1];
  const session = await getSessionForDate(db, user.id, day.ymd);

  if (session?.session.status === "complete") {
    const s = session.session;
    return (
      <>
        <Screen>
          <TzSync current={tzCookie} />
          <Wordmark />
          <div className="mt-10 mb-2 flex items-baseline justify-between">
            <Title>{dayDef.name}</Title>
            <span className="faint">{dayDef.short}</span>
          </div>
          <p className="caption mb-6">Day {s.day_number} · done</p>
          <ul>
            {session.lifts.map((l) => (
              <li key={l.id} className="hairline-row">
                <span className={l.status === "completed" ? "text-text" : "text-text-faint"}>{l.display_name}</span>
                <span className="caption">
                  {formatLoad(l.prescribed_weight)} × {l.prescribed_reps}
                  {l.exercise.rep_unit ?? ""}
                  {l.status === "missed" ? " · missed" : ""}
                </span>
              </li>
            ))}
          </ul>
          {profile.records_video && (
            <p className="caption mt-6">
              {session.lifts.filter((l) => l.status === "completed" && l.email_status === "sent").length} of{" "}
              {session.lifts.filter((l) => l.status === "completed").length} lifts emailed
            </p>
          )}
          <Link href={`/workout/${s.id}/complete`} className="link mt-3 self-start">
            View day
          </Link>
        </Screen>
        <TabBar active="today" />
      </>
    );
  }

  const lifts = session
    ? session.lifts.map((l) => ({
        key: l.exercise_key,
        name: l.display_name,
        weight: l.prescribed_weight,
        reps: l.prescribed_reps,
        repUnit: l.exercise.rep_unit,
        isBodyweight: l.exercise.is_bodyweight,
        status: l.status,
      }))
    : (await previewToday(db, user.id, day)).map((l) => ({ ...l, status: "pending" as const }));

  return (
    <>
      <Screen>
        <TzSync current={tzCookie} />
        <Wordmark />
        <div className="mt-10 mb-4 flex items-baseline justify-between">
          <Title>{dayDef.name}</Title>
          <span className="faint">{dayDef.short}</span>
        </div>
        <ul>
          {lifts.map((l) => (
            <li key={l.key} className="hairline-row">
              <span className={l.status === "completed" ? "text-text-dim" : "text-text"}>{l.name}</span>
              <span className="caption whitespace-nowrap">
                {formatLoad(l.weight)} × {l.reps}
                {l.repUnit ?? ""}
              </span>
            </li>
          ))}
        </ul>
        <WalkNote sessionId={session?.session.id ?? null} done={session?.session.walk_done ?? false} />
        <div className="flex-1" />
        {session ? (
          <PillLink href={`/workout/${session.session.id}`}>Continue workout</PillLink>
        ) : (
          <StartWorkout />
        )}
      </Screen>
      <TabBar active="today" />
    </>
  );
}

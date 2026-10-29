import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PillLink, Screen, TabBar, Wordmark, WeekProgress } from "@/components/ui";
import { TzSync } from "@/components/tz-sync";
import { DAYS, formatPrescription, formatSetWeights, WORK_SETS } from "@/lib/engine";
import { DEFAULT_TZ, isValidTz, localDay } from "@/lib/session/dates";
import { previewWorkout, weekPlan } from "@/lib/session/preview";
import { finalizeStaleSessions, getProfile, getSessionForDate } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";
import { StartWorkout } from "./start-workout";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function DayHeading({ dayIndex, suffix }: { dayIndex: number; suffix?: string }) {
  const def = DAYS[dayIndex - 1];
  return (
    <div className="mt-8 mb-4">
      <div className="title text-[64px] text-ember leading-[0.82]">
        {def.label}
        {suffix && <span className="text-bone"> {suffix}</span>}
      </div>
      <div className="title text-[28px] mt-1.5">{def.name}</div>
    </div>
  );
}

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
  const [session, week] = await Promise.all([getSessionForDate(db, user.id, day.ymd), weekPlan(db, user.id, day)]);
  const weekLine = (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <span className="caption">
          {Math.min(week.count, week.target)} of {week.target} this week
        </span>
        <span className="faint">{WEEKDAYS[day.weekday]}</span>
      </div>
      <WeekProgress count={week.count} target={week.target} live={session?.session.status === "in_progress"} />
    </div>
  );

  if (session?.session.status === "complete") {
    const s = session.session;
    const next = DAYS[week.nextDay - 1];
    return (
      <>
        <Screen>
          <TzSync current={tzCookie} />
          <Wordmark />
          <DayHeading dayIndex={s.day_index} suffix="done" />
          {weekLine}
          <ul className="panel panel-tight">
            {session.lifts.map((l) => {
              const weights = l.sets.filter((x) => x.kind === "work" && x.result === "completed").map((x) => x.actual_weight ?? x.prescribed_weight);
              return (
                <li key={l.id} className="hairline-row">
                  <span className={l.status === "completed" ? "text-bone" : "text-bone-faint"}>{l.display_name}</span>
                  <span className="caption whitespace-nowrap">
                    {l.status === "missed" ? "skipped" : formatSetWeights(l.exercise.is_bodyweight ? [0] : weights, l.prescribed_reps, l.exercise.rep_unit)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="caption mt-6">
            Workout {s.day_number} logged. Next time: {next.label}, {next.name.toLowerCase()}.
          </p>
          <div className="flex-1" />
          <PillLink href="/week" quiet>
            See the week
          </PillLink>
        </Screen>
        <TabBar active="today" />
      </>
    );
  }

  const dayIndex = session?.session.day_index ?? week.nextDay;
  const lifts = session
    ? session.lifts.map((l) => {
        const next = l.sets.find((x) => x.kind === "work" && x.result === "pending");
        return {
          key: l.exercise_key,
          name: l.display_name,
          weight: next?.prescribed_weight ?? l.prescribed_weight,
          reps: l.prescribed_reps,
          repUnit: l.exercise.rep_unit,
          status: l.status,
        };
      })
    : (await previewWorkout(db, user.id, dayIndex, day.date)).map((l) => ({
        key: l.key,
        name: l.name,
        weight: l.weights[0],
        reps: l.reps,
        repUnit: l.repUnit,
        status: "pending" as const,
      }));
  const weekDone = !session && week.count >= week.target;

  return (
    <>
      <Screen>
        <TzSync current={tzCookie} />
        <Wordmark />
        <DayHeading dayIndex={dayIndex} />
        {weekLine}
        <ul className="panel panel-tight">
          {lifts.map((l) => (
            <li key={l.key} className="hairline-row">
              <span className={l.status === "completed" || l.status === "missed" ? "text-bone-faint" : "text-bone"}>{l.name}</span>
              <span className="caption whitespace-nowrap">{formatPrescription(l.weight, l.reps, l.repUnit)}</span>
            </li>
          ))}
        </ul>
        <p className="faint mt-3">
          Starts with a 5-minute warm-up. {WORK_SETS} sets each, and you can change the weight on any set.
        </p>
        <Link href="/week" className="link self-start text-[14px] mt-3">
          See the whole week
        </Link>
        <div className="flex-1 min-h-5" />
        {weekDone && <p className="caption mb-4">All {week.target} done this week. Rest up, or train anyway.</p>}
        {session ? <PillLink href={`/workout/${session.session.id}`}>Continue {DAYS[dayIndex - 1].label}</PillLink> : <StartWorkout label={`Start ${DAYS[dayIndex - 1].label}`} />}
      </Screen>
      <TabBar active="today" />
    </>
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Screen, TabBar, Title, Wordmark, WeekProgress } from "@/components/ui";
import { ResumeBar } from "@/components/resume-bar";
import { formatSetWeights } from "@/lib/engine";
import { DEFAULT_TZ, isValidTz, localDay } from "@/lib/session/dates";
import { weekPlan } from "@/lib/session/preview";
import { finalizeStaleSessions } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function span(first: string, last: string) {
  const [, m1, d1] = first.split("-").map(Number);
  const [, m2, d2] = last.split("-").map(Number);
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}` : `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}`;
}

function weekdayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export default async function WeekPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const cookieStore = await cookies();
  const tzCookie = cookieStore.get("tz")?.value ?? null;
  const today = localDay(isValidTz(tzCookie) ? tzCookie : DEFAULT_TZ);
  await finalizeStaleSessions(db, user.id, today.ymd);
  const week = await weekPlan(db, user.id, today);
  const live = week.workouts.some((w) => w.state === "in_progress");
  let upcomingSeen = 0;

  return (
    <>
      <Screen>
        <Wordmark />
        <ResumeBar />
        <div className="mt-10 mb-6 flex items-end justify-between gap-4">
          <Title>This week</Title>
          <span className="caption pb-1">{span(week.calendar[0].ymd, week.calendar[6].ymd)}</span>
        </div>

        <div className="grid grid-cols-7 gap-1.5 mb-6">
          {week.calendar.map((d) => (
            <div
              key={d.ymd}
              className={`cal-day ${d.trained?.status === "in_progress" ? "cal-day-live" : d.trained ? "cal-day-done" : d.isToday ? "cal-day-today" : ""}`}
              aria-label={`${WEEKDAYS[d.weekday]}${d.trained ? `, Day ${d.trained.dayIndex}` : ""}`}
            >
              <span className="text-[11px] leading-none opacity-80">{LETTERS[d.weekday]}</span>
              <span className="title text-[20px] leading-none mt-1" style={{ color: "inherit" }}>
                {d.trained ? d.trained.dayIndex : "·"}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between mb-2">
          <span className="text-bone">
            {Math.min(week.count, week.target)} of {week.target} workouts
          </span>
          <span className="faint">{week.count >= week.target ? "Week done" : `${week.target - week.count} to go by Sunday`}</span>
        </div>
        <WeekProgress count={week.count} target={week.target} live={live} />

        <div className="mt-8 flex flex-col gap-4">
          {week.workouts.map((w, i) => {
            const isNext = w.state === "upcoming" && upcomingSeen++ === 0 && !live;
            return (
              <section key={`${w.state}-${w.ymd ?? i}-${w.dayIndex}`} className={`panel ${isNext ? "!border-crimson" : ""}`}>
                <div className="flex items-baseline justify-between gap-3 pt-3.5 pb-2.5 border-b hairline">
                  <div className="flex items-baseline gap-3">
                    <span className={`title text-[24px] ${w.state === "upcoming" ? "text-bone" : "text-ember"}`}>{w.label}</span>
                    <span className="text-bone-dim">{w.name}</span>
                  </div>
                  <span className="faint whitespace-nowrap">
                    {w.state === "done" && w.ymd && weekdayOf(w.ymd)}
                    {w.state === "in_progress" && "In progress"}
                    {w.state === "upcoming" && (isNext ? "Up next" : "")}
                  </span>
                </div>
                <ul className="py-1.5">
                  {w.lifts.map((l) => (
                    <li key={l.key} className="flex items-baseline justify-between gap-4 py-1.5">
                      <span className={`text-[15px] ${l.missed ? "text-bone-faint line-through decoration-rust" : "text-bone-dim"}`}>{l.name}</span>
                      <span className="faint whitespace-nowrap">{l.missed ? "skipped" : formatSetWeights(l.weights, l.reps, l.repUnit)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <p className="faint my-6">
          Train any five days, Monday to Sunday. Missing a day never skips a workout: you always pick up with the next one in the rotation.
          Weights for workouts still to come assume today goes as planned.
        </p>
      </Screen>
      <TabBar active="week" />
    </>
  );
}

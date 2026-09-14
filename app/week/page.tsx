import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Screen, TabBar, Title, Wordmark } from "@/components/ui";
import { ResumeBar } from "@/components/resume-bar";
import { formatLoad } from "@/lib/engine";
import { DEFAULT_TZ, isValidTz, localDay } from "@/lib/session/dates";
import { previewWeek } from "@/lib/session/preview";
import { createClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function span(first: string, last: string) {
  const [, m1, d1] = first.split("-").map(Number);
  const [, m2, d2] = last.split("-").map(Number);
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}` : `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}`;
}

export default async function WeekPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const cookieStore = await cookies();
  const tzCookie = cookieStore.get("tz")?.value ?? null;
  const today = localDay(isValidTz(tzCookie) ? tzCookie : DEFAULT_TZ);
  const week = await previewWeek(db, user.id, today);

  return (
    <>
      <Screen>
        <Wordmark />
        <ResumeBar />
        <div className="mt-10 mb-8 flex items-baseline justify-between">
          <Title>The week</Title>
          <span className="faint">{span(week[0].ymd, week[4].ymd)}</span>
        </div>

        {week.map((d) => (
          <section key={d.ymd} className="mb-8">
            <div className="flex items-baseline justify-between border-b hairline pb-2">
              <div className="flex items-baseline gap-3">
                <span className={`title text-[13px] ${d.isToday ? "text-text" : "text-text-faint"}`}>{d.short}</span>
                <span className={d.isToday ? "text-text" : "text-text-dim"}>{d.name.toLowerCase()}</span>
              </div>
              <span className="faint whitespace-nowrap">
                {d.status === "done" && `day ${d.dayNumber} · done`}
                {d.status === "in_progress" && "in progress"}
                {d.status === "past" && "not trained"}
                {d.status === "upcoming" && (d.isToday ? "today" : "")}
              </span>
            </div>
            <ul>
              {d.lifts.map((l) => (
                <li key={l.key} className="flex items-baseline justify-between gap-4 py-2">
                  <span className={l.missed ? "text-text-faint" : "text-text-dim"}>{l.name}</span>
                  <span className="faint whitespace-nowrap">
                    {formatLoad(l.weight)} × {l.reps}
                    {l.repUnit ?? ""}
                    {l.missed ? " · missed" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="faint mb-6">
          Saturday and Sunday are yoga days. Weights for days you haven&rsquo;t trained yet assume this week goes as planned — they move
          with every lift you log.
        </p>
      </Screen>
      <TabBar active="week" />
    </>
  );
}

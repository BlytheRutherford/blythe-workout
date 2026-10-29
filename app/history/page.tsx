import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Screen, TabBar, Title, Wordmark } from "@/components/ui";
import { ResumeBar } from "@/components/resume-bar";
import { DEFAULT_TZ, isValidTz, localDay } from "@/lib/session/dates";
import { completedDates } from "@/lib/session/service";
import { createClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const db = await createClient();
  const sp = await searchParams;
  const cookieStore = await cookies();
  const tzCookie = cookieStore.get("tz")?.value ?? null;
  const today = localDay(isValidTz(tzCookie) ? tzCookie : DEFAULT_TZ);

  const [ty, tm] = today.ymd.split("-").map(Number);
  let year = Number(sp.y ?? ty);
  let month = Number(sp.m ?? tm);
  if (!(month >= 1 && month <= 12) || !(year > 2000 && year < 2100)) {
    year = ty;
    month = tm;
  }
  const first = `${year}-${pad(month)}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const last = `${year}-${pad(month)}-${pad(daysInMonth)}`;
  const done = await completedDates(db, user.id, first, last);
  const doneMap = new Map(done.map((d) => [d.date, d.dayNumber]));
  const startWeekday = new Date(year, month - 1, 1).getDay(); // 0 Sun
  const offset = (startWeekday + 6) % 7; // Monday-first grid

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const { count: total } = await db.from("sessions").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "complete");

  return (
    <>
      <Screen>
        <Wordmark />
        <ResumeBar />
        <div className="mt-10 mb-6 flex items-center justify-between">
          <Title>
            {MONTHS[month - 1]} {year}
          </Title>
          <div className="flex gap-2">
            <Link href={`/history?y=${prev.y}&m=${prev.m}`} aria-label="Previous month" className="stepper !w-11 !h-11 !text-[20px]">
              ‹
            </Link>
            <Link href={`/history?y=${next.y}&m=${next.m}`} aria-label="Next month" className="stepper !w-11 !h-11 !text-[20px]">
              ›
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center faint mb-2">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: offset }).map((_, i) => (
            <div key={`o${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const ymd = `${year}-${pad(month)}-${pad(i + 1)}`;
            const isDone = doneMap.has(ymd);
            const isToday = ymd === today.ymd;
            return (
              <div
                key={ymd}
                className={`cal-day text-[14px] ${isDone ? "cal-day-done font-semibold" : isToday ? "cal-day-today" : ""}`}
                title={isDone ? `Workout ${doneMap.get(ymd)}` : undefined}
              >
                {i + 1}
              </div>
            );
          })}
        </div>
        <p className="caption mt-8">
          {done.length} workout{done.length === 1 ? "" : "s"} this month, {total ?? 0} in all
        </p>
      </Screen>
      <TabBar active="history" />
    </>
  );
}

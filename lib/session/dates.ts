export const DEFAULT_TZ = "America/Chicago";

export interface LocalDay {
  /** YYYY-MM-DD in the user's zone */
  ymd: string;
  /** 0–6 Sun–Sat */
  weekday: number;
  /** Date at local midnight (for ISO-week math) */
  date: Date;
}

export function isValidTz(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The user's local calendar day right now (or for a given instant). */
export function localDay(tz: string, at: Date = new Date()): LocalDay {
  const zone = isValidTz(tz) ? tz : DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const [y, m, d] = ymd.split("-").map(Number);
  return { ymd, weekday, date: new Date(y, m - 1, d) };
}

export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((ymdToDate(toYmd).getTime() - ymdToDate(fromYmd).getTime()) / 86400000);
}

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The Monday–Sunday week containing `day`: seven dates, Monday first. */
export function weekOf(day: LocalDay): { ymd: string; date: Date; weekday: number }[] {
  const monday = new Date(day.date);
  monday.setDate(monday.getDate() - ((day.weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return { ymd: toYmd(d), date: d, weekday: d.getDay() };
  });
}

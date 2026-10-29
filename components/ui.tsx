import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/** The red sun and the name. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span aria-hidden className="block w-[14px] h-[14px] rounded-full bg-ember shadow-[0_0_18px_rgba(244,44,29,0.7)]" />
      <span className="title text-[22px]">Blythe Workout</span>
    </div>
  );
}

/** The one loud button on a screen. `quiet` for the secondary choice. */
export function Pill({ children, className = "", quiet = false, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { quiet?: boolean }) {
  return (
    <button type="button" className={`pill ${quiet ? "pill-quiet" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function PillLink({ href, children, className = "", quiet = false }: { href: string; children: ReactNode; className?: string; quiet?: boolean }) {
  return (
    <Link href={href} className={`pill ${quiet ? "pill-quiet" : ""} ${className}`}>
      {children}
    </Link>
  );
}

export function Field(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="field" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="field" {...props} />;
}

/**
 * Renders a number string with every digit in an equal-width box so timers and
 * hero numbers don't jitter as they change. The × is drawn in ember.
 */
export function Digits({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span className={className} aria-label={value}>
      {value.split("").map((ch, i) => {
        if (/\d/.test(ch)) {
          return (
            <span key={i} className="digit">
              {ch}
            </span>
          );
        }
        const width = ch === " " ? "0.16em" : ch === ":" || ch === "." ? "0.24em" : ch === "×" ? "0.5em" : undefined;
        return (
          <span key={i} className={`digit-sep ${ch === "×" ? "hero-x" : ""}`} style={{ width }}>
            {ch === " " ? " " : ch}
          </span>
        );
      })}
    </span>
  );
}

/** Standard screen frame: padded column, safe areas. */
export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`flex-1 flex flex-col px-6 safe-top safe-bottom ${className}`}>{children}</main>;
}

export function Title({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h1 className={`title text-[40px] ${className}`}>{children}</h1>;
}

/** Bottom tab bar. Never shown on the live workout screen. */
export function TabBar({ active }: { active: "today" | "week" | "history" | "settings" }) {
  const item = (href: string, label: string, key: typeof active) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`relative flex-1 text-center pt-3.5 pb-2 text-[13px] font-medium ${active === key ? "text-bone" : "text-bone-faint"}`}
    >
      {active === key && <span aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-ember" />}
      {label}
    </Link>
  );
  return (
    <nav className="sticky bottom-0 border-t hairline flex px-2 safe-bottom bg-ink/90 backdrop-blur-md">
      {item("/today", "Today", "today")}
      {item("/week", "Week", "week")}
      {item("/history", "History", "history")}
      {item("/settings", "Settings", "settings")}
    </nav>
  );
}

/** Five segments: this week's workouts against the target. */
export function WeekProgress({ count, target, live = false }: { count: number; target: number; live?: boolean }) {
  return (
    <div className="flex gap-1.5" role="img" aria-label={`${Math.min(count, target)} of ${target} workouts this week`}>
      {Array.from({ length: target }).map((_, i) => (
        <span
          key={i}
          className={`week-seg ${i < count - (live ? 1 : 0) ? "week-seg-done" : live && i === count - 1 ? "week-seg-live" : ""}`}
        />
      ))}
    </div>
  );
}

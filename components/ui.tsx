import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Wordmark({ className = "" }: { className?: string }) {
  return <div className={`title text-[15px] ${className}`}>BLYTHE WORKOUT</div>;
}

/** Full-width butter pill. RECORD, LOG SET, SIGN IN, START WORKOUT … */
export function Pill({ children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`pill ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function PillLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`pill ${className}`}>
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
 * hero numbers don't jitter, even in a face without tabular figures (Fraunces).
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
        const width = ch === " " ? "0.22em" : ch === ":" || ch === "." ? "0.3em" : ch === "×" ? "0.62em" : undefined;
        return (
          <span key={i} className="digit-sep" style={{ width }}>
            {ch === " " ? "\u00A0" : ch}
          </span>
        );
      })}
    </span>
  );
}

/** Standard screen frame: padded column, safe areas, black background. */
export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`flex-1 flex flex-col px-6 safe-top safe-bottom ${className}`}>{children}</main>;
}

export function Title({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h1 className={`title text-[22px] ${className}`}>{children}</h1>;
}

/** Bottom tab bar — Today · History · Settings. Never shown on live / countdown / recording / rest. */
export function TabBar({ active }: { active: "today" | "history" | "settings" }) {
  const item = (href: string, label: string, key: typeof active) => (
    <Link
      href={href}
      className={`flex-1 text-center py-3 text-[12px] tracking-[0.12em] uppercase ${active === key ? "text-text" : "text-text-faint"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="border-t hairline flex px-4 safe-bottom bg-bg">
      {item("/today", "Today", "today")}
      {item("/history", "History", "history")}
      {item("/settings", "Settings", "settings")}
    </nav>
  );
}

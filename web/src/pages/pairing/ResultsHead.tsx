import type { ReactNode } from "react";
import type { Goal } from "../../lib/api";

// .results-head: kicker, heading, a one-line summary, and an optional control on the right.
// The summary slot keeps its height while loading, so the list below never jumps.
export function ResultsHead({ goal, summary, aside }: { goal: Goal; summary: ReactNode | null; aside?: ReactNode }) {
  return (
    <div className="mb-[30px] flex flex-col items-start gap-[22px] sm:flex-row sm:items-end sm:justify-between sm:gap-[30px]">
      <div>
        <p className="kicker">{goal === "soften" ? "Soften the edge" : "Amplify it"}</p>
        <h2 className="mt-2 mb-[7px] font-display text-[41px] leading-none font-medium tracking-heading sm:text-[clamp(38px,4.2vw,57px)]">
          Your layering accords
        </h2>
        <p aria-live="polite" className="m-0 min-h-[1.6em] max-w-[590px] text-xs leading-[1.6] text-dim">
          {summary ?? <span className="skeleton inline-block h-3 w-64 align-middle" />}
        </p>
      </div>
      {aside}
    </div>
  );
}

// .switch-row: a checkbox drawn as a sliding switch. The real input stays in the page
// (visually hidden), so Tab, Space, and screen readers treat it as a checkbox.
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 pb-[7px] text-[10px] font-semibold tracking-[0.12em] text-soft uppercase">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <i
        aria-hidden="true"
        className="relative h-5 w-[38px] rounded-[20px] border border-line-switch transition-all duration-[180ms] peer-checked:border-gold-deep peer-checked:bg-gold-shadow peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold after:absolute after:top-[3px] after:left-[3px] after:size-3 after:rounded-full after:bg-dim after:transition-all after:duration-[180ms] peer-checked:after:translate-x-[18px] peer-checked:after:bg-gold-bright"
      />
    </label>
  );
}

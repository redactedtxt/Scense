import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { familyColor } from "../lib/labels";

// Small shared pieces. Each matches a class in the Figma export, named in the comment.

// .score: label, number, a 2px bar, and an italic caption.
export function ScoreBar({ score, caption }: { score: number; caption: string }) {
  return (
    <div className="min-w-0">
      <div className="label-caps flex items-baseline justify-between text-dim">
        <span>Layering score</span>
        <strong className="font-display text-[27px] font-normal tracking-normal text-gold-bright normal-case">
          {Math.round(score)}
        </strong>
      </div>
      <div className="mt-2 mb-[7px] h-0.5 bg-line" aria-hidden="true">
        <span
          className="block h-full bg-linear-to-r from-gold-dark to-gold-bright"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <p className="m-0 font-display text-xs text-ghost italic">{caption}</p>
    </div>
  );
}

// .family-tag / .tags span: a small outlined pill.
export function Tag({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "owned" }) {
  const colours = tone === "owned" ? "border-gold-line text-gold-kicker" : "border-line-control text-dim";
  return (
    <span className={`inline-block rounded-full border px-[9px] py-[5px] text-[8px] tracking-tag uppercase ${colours}`}>
      {children}
    </span>
  );
}

// A family tag with a dot in the family's tint, for places without a bottle picture.
export function FamilyTag({ family }: { family: string }) {
  return (
    <Tag>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: familyColor(family) }} />
        {family}
      </span>
    </Tag>
  );
}

// .segmented: two or more options in a bordered strip, the chosen one filled gold.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid border border-line-control p-[3px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-[38px] cursor-pointer px-2 text-[10px] font-semibold tracking-label uppercase transition-colors ${
            value === option.value ? "bg-gold-deep text-on-gold" : "text-dim hover:text-text"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// .text-tabs, with the WAI-ARIA tabs keyboard model: one tab stop, arrow keys switch.
// Each tab gets the id "tab-<value>", so the panel can say aria-labelledby="tab-<value>".
export function TextTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  panelId,
}: {
  label: string;
  tabs: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  panelId: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="flex gap-[30px]">
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={`tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`cursor-pointer border-b pb-[7px] font-display text-[27px] transition-colors ${
              selected ? "border-gold-kicker text-text-bright" : "border-transparent text-faint hover:text-muted"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// A grey message line used for empty and error states.
export function Notice({ children, role }: { children: ReactNode; role?: "alert" | "status" }) {
  return (
    <p role={role} className="m-0 max-w-[590px] py-10 font-display text-xl leading-snug text-soft">
      {children}
    </p>
  );
}

// The outlined "Show more" / "Next page" button.
export function OutlineButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer border border-line-control px-6 py-3 text-[10px] font-semibold tracking-label text-muted uppercase transition-colors hover:border-gold-deep hover:text-text-bright disabled:cursor-default disabled:opacity-50"
    >
      {children}
    </button>
  );
}

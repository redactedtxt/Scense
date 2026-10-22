// The answer options under the concierge's latest question ("Low", "Medium", "High").
// Tapping one sends its label as the visitor's message. Chip answers are free: they
// don't count against the day's typed messages (DECISIONS B38). `onPick` is null while
// nothing can be sent (a reply is on its way, or the concierge is unavailable), and the
// chips are disabled.
export function AnswerChips({ options, onPick }: { options: string[]; onPick: ((label: string) => void) | null }) {
  return (
    <div role="group" aria-label="Quick answers" className="mt-4 flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onPick?.(option)}
          disabled={onPick === null}
          className="min-h-[38px] cursor-pointer rounded-full border border-gold-line px-4 text-[12px] tracking-[0.04em] text-chip-on-text transition-colors hover:border-gold hover:text-text-bright disabled:cursor-default disabled:opacity-50"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

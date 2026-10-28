import { useRef, useState } from "react";
import { BottleImage } from "../../components/BottleImage";
import { Combobox, SuggestionRow } from "../../components/Combobox";
import { BrandLink } from "../../components/Price";
import { Segmented, TextTabs } from "../../components/ui";
import type { FragranceDetail, Goal } from "../../lib/api";
import { useFragranceSuggestions, useNoteSuggestions } from "../../lib/queries";
import { MAX_NOTES, type Mode } from "./usePairingParams";

const MODES: { value: Mode; label: string }[] = [
  { value: "fragrance", label: "Fragrance" },
  { value: "notes", label: "Notes" },
];
const GOALS: { value: Goal; label: string }[] = [
  { value: "enhance", label: "Enhance" },
  { value: "soften", label: "Soften" },
];

type Props = {
  mode: Mode;
  goal: Goal;
  // `chosen` is false until a fragrance is in the URL; then nothing is selected yet.
  base: { data: FragranceDetail | undefined; isError: boolean; chosen: boolean };
  notes: string[];
  onModeChange: (mode: Mode) => void;
  onGoalChange: (goal: Goal) => void;
  onBaseChange: (slug: string) => void;
  onNotesChange: (notes: string[]) => void;
};

// .pairing-desk: step 01 picks what to start from, step 02 picks the goal.
export function PairingDesk(props: Props) {
  return (
    <section
      aria-label="Pairing"
      className="relative z-[2] -mx-5 border-y border-line-strong bg-[linear-gradient(100deg,rgba(171,117,47,0.06),transparent_35%),var(--color-panel)] px-5 pt-[30px] pb-7 shadow-[0_25px_70px_rgba(0,0,0,0.28)] sm:mx-0 sm:border-x sm:px-[42px] sm:pt-[38px] sm:pb-9"
    >
      <div className="grid grid-cols-1 gap-[26px] sm:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)] sm:gap-[50px]">
        <div>
          <p className="kicker">01 — Begin with</p>
          <div className="mt-[13px]">
            <TextTabs
              label="Begin with"
              tabs={MODES}
              value={props.mode}
              onChange={props.onModeChange}
              panelId="pairing-panel"
            />
          </div>
        </div>
        <div className="border-t border-line pt-6 sm:border-0 sm:pt-0">
          <p className="kicker">02 — I want to</p>
          <div className="mt-3">
            <Segmented label="Goal" options={GOALS} value={props.goal} onChange={props.onGoalChange} />
          </div>
        </div>
      </div>
      <div id="pairing-panel" role="tabpanel" aria-labelledby={`tab-${props.mode}`} className="mt-[23px] sm:mt-7">
        {props.mode === "fragrance" ? (
          <BasePicker base={props.base} onChange={props.onBaseChange} />
        ) : (
          <NotePicker notes={props.notes} onChange={props.onNotesChange} />
        )}
      </div>
    </section>
  );
}

// Fragrance mode: search box plus the chosen bottle (.selected-fragrance).
function BasePicker({ base, onChange }: { base: Props["base"]; onChange: (slug: string) => void }) {
  // null = the box shows the chosen fragrance's name; a string = the user is typing.
  const [typed, setTyped] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useFragranceSuggestions(typed ?? "");
  const value = typed ?? base.data?.name ?? "";

  return (
    <div>
      <Combobox
        label="Search fragrances"
        placeholder="Search a fragrance you own…"
        value={value}
        onValueChange={setTyped}
        items={typed ? (suggestions.data ?? []) : []}
        loading={suggestions.isFetching}
        itemKey={(f) => f.slug}
        renderItem={(f) => (
          <SuggestionRow
            title={f.name}
            detail={`${f.brand} · ${f.dominantFamily}`}
            image={{ src: f.imageUrl, family: f.dominantFamily }}
          />
        )}
        onSelect={(f) => {
          onChange(f.slug);
          setTyped(null);
        }}
        emptyText="No fragrance in the catalogue matches."
        inputRef={inputRef}
        trailing={
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setTyped("");
              inputRef.current?.focus();
            }}
            className="cursor-pointer text-[22px] text-dim hover:text-text"
          >
            ×
          </button>
        }
      />
      <SelectedBase base={base} />
    </div>
  );
}

// .selection-meta. Fixed sizes on the picture and text lines, so loading moves nothing.
function SelectedBase({ base }: { base: Props["base"] }) {
  const f = base.data;
  if (!base.chosen) return null;
  if (base.isError) {
    return (
      <p role="alert" className="m-0 pt-[18px] font-display text-lg text-soft">
        We could not find that fragrance. Search for another one above.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-[48px_1fr] items-center gap-[13px] pt-[18px] sm:grid-cols-[54px_1fr_auto] sm:gap-[18px]">
      {f ? (
        <BottleImage src={f.imageUrl} family={f.dominantFamily} className="h-14 w-12 bg-frame-alt sm:h-[62px] sm:w-[54px]" />
      ) : (
        <div className="skeleton h-14 w-12 sm:h-[62px] sm:w-[54px]" />
      )}
      <div className="min-w-0">
        <p className="kicker truncate">
          {f ? (
            <>
              <BrandLink brand={f.brand} />
              {f.releaseYear ? ` · ${f.releaseYear}` : ""}
            </>
          ) : (
            " "
          )}
        </p>
        <strong className="mt-1 mb-0.5 block truncate font-display text-[17px] font-medium sm:text-xl">
          {f?.name ?? " "}
        </strong>
        <p className="m-0 text-[10px] text-dim">{f?.dominantFamily ?? " "}</p>
      </div>
      <span className="hidden border border-line-input px-2.5 py-[7px] text-[9px] tracking-[0.14em] text-gold-rank uppercase sm:inline">
        Selected
      </span>
    </div>
  );
}

// Notes mode: autocomplete adds a note, each chip removes one (.note-picker, .note-chips).
function NotePicker({ notes, onChange }: { notes: string[]; onChange: (notes: string[]) => void }) {
  const [text, setText] = useState("");
  const suggestions = useNoteSuggestions(text);
  const full = notes.length >= MAX_NOTES;
  // Hide notes already picked, so the list only offers new ones.
  const options = (suggestions.data ?? []).filter((s) => !notes.includes(s.name));

  return (
    <div>
      <Combobox
        label="Search notes"
        placeholder={full ? `Up to ${MAX_NOTES} notes` : "Search a note…"}
        value={text}
        onValueChange={setText}
        items={full ? [] : options}
        loading={suggestions.isFetching}
        itemKey={(n) => n.name}
        renderItem={(n) => <SuggestionRow title={n.name} detail={n.dominantFamily} />}
        onSelect={(n) => {
          onChange([...notes, n.name]);
          setText("");
        }}
        emptyText={full ? `You can pick up to ${MAX_NOTES} notes.` : "No mapped note matches."}
        trailing={<span />}
      />
      <ul aria-label="Selected notes" className="mt-5 flex min-h-[42px] list-none flex-wrap gap-[9px] p-0">
        {notes.map((note) => (
          <li key={note}>
            <button
              type="button"
              aria-label={`Remove ${note}`}
              onClick={() => onChange(notes.filter((n) => n !== note))}
              className="cursor-pointer rounded-full border border-gold-icon bg-chip-on px-3.5 py-[9px] font-display text-[15px] text-chip-on-text transition-colors hover:border-gold"
            >
              {note} <span aria-hidden="true" className="ml-1 text-gold-icon">×</span>
            </button>
          </li>
        ))}
        {notes.length === 0 && <li className="self-center text-xs text-dim">No notes picked yet.</li>}
      </ul>
    </div>
  );
}

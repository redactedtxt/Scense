import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError } from "../lib/api";
import { useSaveTasteProfile, useTasteProfile } from "../lib/taste";
import {
  describeProfile,
  emptyProfile,
  FACETS,
  FAMILIES,
  isBlank,
  likesAndDislikes,
  strengthWord,
  type TasteProfile,
  type Weight,
} from "../lib/tasteProfile";

// The taste profile card (SPEC section 11, decision 9): what the chatbot learned, in
// plain words, with an Edit mode of sliders from -1 to 1. It sits beside the chat on
// /chat and on /me. Where it saves (browser or account) is lib/taste.ts's business.
export function TasteProfileCard({ showChatLink = false }: { showChatLink?: boolean }) {
  const { profile, ready } = useTasteProfile();
  const [editing, setEditing] = useState(false);
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="border border-line-strong bg-panel p-6 sm:p-7">
      <p className="kicker">Taste profile</p>
      <h2 id={headingId} className="mt-3 mb-4 font-display text-[28px] leading-none font-medium tracking-heading">
        What you like
      </h2>
      {!ready ? (
        <p role="status" className="m-0 font-display text-lg text-soft">
          Loading your profile…
        </p>
      ) : editing ? (
        <EditForm profile={profile ?? emptyProfile()} onClose={() => setEditing(false)} />
      ) : (
        <Summary profile={profile} showChatLink={showChatLink} onEdit={() => setEditing(true)} />
      )}
    </section>
  );
}

function Summary({ profile, showChatLink, onEdit }: { profile: TasteProfile | null; showChatLink: boolean; onEdit: () => void }) {
  if (profile === null || isBlank(profile)) {
    return (
      <>
        <p className="m-0 mb-5 font-display text-lg leading-snug text-soft">
          No taste profile yet. Describe what you like in the chat, or set it by hand.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {showChatLink && (
            <Link to="/chat" className="kicker hover:text-gold-bright">
              Open the chat
            </Link>
          )}
          <SmallButton onClick={onEdit}>Set it by hand</SmallButton>
        </div>
      </>
    );
  }
  const { likes, dislikes } = likesAndDislikes(profile);
  return (
    <>
      {profile.summary && <p className="m-0 mb-5 font-display text-lg leading-snug text-text">{profile.summary}</p>}
      <WeightList title="Drawn to" weights={likes} empty="Nothing stands out yet." />
      <WeightList title="Steers clear of" weights={dislikes} empty="Nothing you dislike yet." />
      <SmallButton onClick={onEdit}>Edit</SmallButton>
    </>
  );
}

// "Woody Amber · Loves" with a bar as long as the weight. Likes are gold, dislikes grey.
function WeightList({ title, weights, empty }: { title: string; weights: Weight[]; empty: string }) {
  return (
    <div className="mb-5">
      <h3 className="label-caps m-0 mb-2 text-[9px] font-semibold text-gold-kicker">{title}</h3>
      {weights.length === 0 ? (
        <p className="m-0 text-[12px] text-dim">{empty}</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {weights.map((w) => (
            <li key={w.name} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
              <span className="font-display text-[17px] text-text">{w.label}</span>
              <span className="text-[10px] tracking-tag text-dim uppercase">{strengthWord(w.value)}</span>
              <span aria-hidden="true" className="col-span-2 mt-1 h-0.5 bg-line">
                <span
                  className={`block h-full ${w.value > 0 ? "bg-gold-deep" : "bg-faint"}`}
                  style={{ width: `${Math.round(Math.abs(w.value) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Edit mode: one slider per family and facet, -1 (avoid) to 1 (love). Save rebuilds the
// summary from the numbers, so the card never shows a line that no longer fits.
function EditForm({ profile, onClose }: { profile: TasteProfile; onClose: () => void }) {
  const save = useSaveTasteProfile();
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (group: "families" | "facets", name: string, value: number) =>
    setDraft((d) => ({ ...d, [group]: { ...d[group], [name]: value } }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save({ ...draft, summary: describeProfile(draft) });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Saving didn't work. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Edit taste profile">
      <p className="m-0 mb-5 text-[12px] leading-snug text-dim">From −1 (avoid) through 0 (no opinion) to 1 (love).</p>
      <SliderGroup title="Families" names={FAMILIES} values={draft.families} onChange={(n, v) => set("families", n, v)} />
      <SliderGroup title="Facets" names={FACETS} values={draft.facets} onChange={(n, v) => set("facets", n, v)} />
      {error && (
        <p role="alert" className="m-0 mb-4 text-[12px] text-chip-on-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="h-[42px] cursor-pointer bg-gold-deep px-5 text-[10px] font-semibold tracking-label text-on-gold uppercase transition-colors hover:bg-gold disabled:cursor-default disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <SmallButton onClick={onClose} disabled={busy}>
          Cancel
        </SmallButton>
      </div>
    </form>
  );
}

function SliderGroup({
  title,
  names,
  values,
  onChange,
}: {
  title: string;
  names: readonly string[];
  values: Record<string, number>;
  onChange: (name: string, value: number) => void;
}) {
  return (
    <fieldset className="m-0 mb-6 border-0 p-0">
      <legend className="label-caps mb-3 p-0 text-[9px] font-semibold text-gold-kicker">{title}</legend>
      <div className="grid gap-3">
        {names.map((name) => (
          <Slider key={name} name={name} value={values[name] ?? 0} onChange={(v) => onChange(name, v)} />
        ))}
      </div>
    </fieldset>
  );
}

function Slider({ name, value, onChange }: { name: string; value: number; onChange: (value: number) => void }) {
  const id = useId();
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  const shown = value === 0 ? "0" : value.toFixed(1);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
      <label htmlFor={id} className="truncate text-[12px] text-muted">
        {label}
      </label>
      <output htmlFor={id} className="w-9 text-right font-display text-[15px] text-gold-bright tabular-nums">
        {shown}
      </output>
      <input
        id={id}
        type="range"
        min={-1}
        max={1}
        step={0.1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={`${shown}, ${value === 0 ? "no opinion" : strengthWord(value).toLowerCase()}`}
        className="col-span-2 mt-1 w-full cursor-pointer accent-gold-deep"
      />
    </div>
  );
}

function SmallButton({ children, onClick, disabled }: { children: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[42px] cursor-pointer border border-line-control px-5 text-[10px] font-semibold tracking-label text-muted uppercase transition-colors hover:border-gold-deep hover:text-text-bright disabled:cursor-default disabled:opacity-50"
    >
      {children}
    </button>
  );
}

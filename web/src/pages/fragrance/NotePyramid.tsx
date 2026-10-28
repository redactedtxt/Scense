import { useState } from "react";
import type { FragranceDetail, NoteRef } from "../../lib/api";
import { familyColor } from "../../lib/labels";

// The note pyramid (DECISIONS B42): three tiers, narrow at the top, as perfumers draw it.
// Each tier says in plain words when you smell it. A fragrance listed without layers gets
// one row instead.

const TIERS = [
  { key: "top", label: "Top notes", line: "The first impression, for roughly the first 15 to 30 minutes.", inset: "sm:mx-[16%]" },
  { key: "heart", label: "Heart notes", line: "The main character, over the next few hours.", inset: "sm:mx-[8%]" },
  { key: "base", label: "Base notes", line: "The dry-down that lasts longest, and stays on skin.", inset: "" },
] as const;

export function NotePyramid({ notes }: { notes: FragranceDetail["notes"] }) {
  const tiers = TIERS.filter((tier) => notes[tier.key].length > 0);
  if (tiers.length === 0 && notes.flat.length === 0) {
    return <p className="m-0 text-xs text-dim">The dataset lists no notes for this fragrance.</p>;
  }
  if (tiers.length === 0) return <FlatNotes notes={notes.flat} />;
  return (
    <ol aria-label="Note pyramid, from first impression to dry-down" className="m-0 grid list-none gap-2 p-0">
      {tiers.map((tier, index) => (
        <li key={tier.key} className={tier.inset}>
          <Tier label={tier.label} line={tier.line} notes={notes[tier.key]} shade={index} />
        </li>
      ))}
    </ol>
  );
}

// One band of the pyramid. Lower bands are a shade warmer, so the shape reads at a glance.
function Tier({ label, line, notes, shade }: { label: string; line: string; notes: NoteRef[]; shade: number }) {
  const fills = ["bg-panel-alt", "bg-frame", "bg-frame-alt"];
  return (
    <section aria-label={label} className={`border border-line-control px-4 py-4 text-center sm:px-5 ${fills[shade] ?? fills[0]}`}>
      <h3 className="m-0 font-display text-[19px] leading-none font-medium text-text">{label}</h3>
      <p className="mt-1.5 mb-3.5 text-[11px] leading-snug text-soft">{line}</p>
      <NoteChips notes={notes} centred />
    </section>
  );
}

// No layers in the dataset: every note at once, from first spray to dry-down.
function FlatNotes({ notes }: { notes: NoteRef[] }) {
  return (
    <section aria-label="All notes" className="border border-line-control bg-panel-alt px-4 py-4 sm:px-5">
      <h3 className="m-0 font-display text-[19px] leading-none font-medium text-text">All notes</h3>
      <p className="mt-1.5 mb-3.5 text-[11px] leading-snug text-soft">
        This fragrance lists its notes without layers, so you smell them together from the first spray to the
        dry-down.
      </p>
      <NoteChips notes={notes} />
    </section>
  );
}

function NoteChips({ notes, centred = false }: { notes: NoteRef[]; centred?: boolean }) {
  return (
    <ul className={`m-0 flex list-none flex-wrap gap-2 p-0 ${centred ? "justify-center" : ""}`}>
      {notes.map((note) => (
        <li key={note.name}>
          <NoteChip note={note} />
        </li>
      ))}
    </ul>
  );
}

// A note as a chip tinted by its family, with Fragrantica's note picture (hotlinked like
// the bottle photos, DECISIONS B19). The picture's 28px frame is always there, so nothing
// moves as pictures arrive; a missing or refused picture becomes a family-tinted drop.
function NoteChip({ note }: { note: NoteRef }) {
  const tint = note.family ? familyColor(note.family) : "var(--color-line-input)";
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 font-display text-[15px] leading-none text-text-input"
      style={{ borderColor: tint, background: `color-mix(in srgb, ${tint} 12%, transparent)` }}
      title={note.family ? `${note.name} · ${note.family}` : note.name}
    >
      <NoteIcon src={note.imageUrl} tint={tint} />
      {note.name}
    </span>
  );
}

function NoteIcon({ src, tint }: { src: string | null; tint: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = src !== null && failedSrc !== src;
  return (
    <span aria-hidden="true" className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-paper">
      {showPhoto ? (
        <img
          src={src}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="size-full object-cover"
          data-testid="note-photo"
        />
      ) : (
        <svg viewBox="0 0 20 20" className="size-full" style={{ color: tint, background: "var(--color-frame)" }} data-testid="note-placeholder">
          <path d="M10 4c2.6 3.3 4 5.6 4 7.4a4 4 0 0 1-8 0C6 9.6 7.4 7.3 10 4z" fill="currentColor" fillOpacity="0.75" />
        </svg>
      )}
    </span>
  );
}

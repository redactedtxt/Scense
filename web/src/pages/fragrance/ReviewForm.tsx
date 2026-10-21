import { useId, useState, type FormEvent } from "react";
import { StarInput } from "../../components/Stars";
import { ApiError, type Review } from "../../lib/api";
import { formatCount } from "../../lib/labels";
import { useSaveReview } from "../../lib/reviews";

// Must match the API's limit (MAX_REVIEW_CHARS). Characters are counted the way the
// database counts them, so an emoji is one, not two.
export const MAX_REVIEW_CHARS = 2000;

export function charCount(text: string): number {
  return [...text.trim()].length;
}

// Write a new review, or edit the user's existing one (`existing` set).
export function ReviewForm({
  fragranceId,
  existing,
  onDone,
}: {
  fragranceId: number;
  existing: Review | null;
  onDone: () => void;
}) {
  const [stars, setStars] = useState<number | null>(existing?.stars ?? null);
  const [body, setBody] = useState(existing?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useSaveReview(fragranceId);
  const id = useId();
  const count = charCount(body);
  const over = count > MAX_REVIEW_CHARS;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (stars === null) return setError("Choose from 1 to 5 stars.");
    if (count === 0) return setError("Write a few words about how it wore.");
    setError(null);
    setSaving(true);
    try {
      await save({ stars, body }, existing !== null);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your review. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label={existing ? "Edit your review" : "Write a review"} className="grid gap-6">
      <StarInput legend="Your rating" value={stars} onChange={setStars} />
      <div>
        <label htmlFor={id} className="label-caps block text-[9px] font-semibold text-gold-kicker">
          Your review
        </label>
        <textarea
          id={id}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          aria-describedby={`${id}-count`}
          placeholder="How did it open, how long did it last, when would you wear it?"
          className="mt-2 block w-full min-w-0 resize-y border border-line-input bg-transparent p-3 font-display text-lg leading-snug text-text-input outline-0 transition-colors placeholder:text-faint focus:border-gold"
        />
        <p id={`${id}-count`} className={`m-0 mt-2 text-right text-[11px] ${over ? "text-chip-on-text" : "text-dim"}`}>
          {formatCount(count)} / {formatCount(MAX_REVIEW_CHARS)}
        </p>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12px] leading-snug text-chip-on-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || over}
          className="h-[46px] cursor-pointer bg-gold-deep px-6 text-[10px] font-semibold tracking-label text-on-gold uppercase transition-colors hover:bg-gold disabled:cursor-default disabled:opacity-60"
        >
          {saving ? "Saving…" : existing ? "Save changes" : "Post review"}
        </button>
        {existing && (
          <button
            type="button"
            onClick={onDone}
            className="h-[46px] cursor-pointer px-4 text-[10px] font-semibold tracking-label text-muted uppercase hover:text-text-bright"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

import { useState } from "react";
import { SignInPrompt, StarDisplay } from "../../components/Stars";
import { Notice, OutlineButton, Tag } from "../../components/ui";
import { ApiError, type FragranceDetail, type Review } from "../../lib/api";
import { formatCount } from "../../lib/labels";
import { useDeleteReview, useReviews } from "../../lib/reviews";
import { useSession } from "../../lib/session";
import { ReviewForm } from "./ReviewForm";

// The fragrance page's written reviews (M8), under the dataset's community rating and
// the detail panels. Anyone can read; a signed-in user writes, edits, or deletes their
// one review here. Review text is put on the page as React text, never as HTML, so a
// "<script>" in a review is shown as those characters and never runs.

const DATE_FORMAT = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });
// A save within a minute of posting (a quick typo fix) doesn't earn an "Edited" mark.
const EDIT_GRACE_MS = 60_000;

export function Reviews({ fragrance }: { fragrance: FragranceDetail }) {
  const { query, items, total, mine } = useReviews(fragrance.id);
  return (
    <section aria-labelledby="reviews-heading" className="mt-16 sm:mt-20">
      <p className="kicker">Reviews</p>
      <h2 id="reviews-heading" className="mt-[7px] mb-2 font-display text-[30px] font-medium sm:text-[36px]">
        From wearers
      </h2>
      <p className="m-0 mb-8 text-xs text-dim">
        {total > 0 ? `${formatCount(total)} ${total === 1 ? "review" : "reviews"} on Scense. ` : ""}
        The community rating above comes from Fragrantica votes; these are written here.
      </p>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,380px)_1fr] md:gap-16">
        <YourReview fragranceId={fragrance.id} mine={mine} ready={query.isSuccess} />
        <div className="min-w-0">
          {query.isError && <Notice role="alert">Could not load reviews. Try again in a moment.</Notice>}
          {query.isPending && <ReviewSkeleton />}
          {query.isSuccess && items.length === 0 && <p className="m-0 font-display text-xl text-soft">No reviews yet.</p>}
          <ol aria-label="Reviews" className="m-0 list-none border-t border-line-strong p-0" hidden={items.length === 0}>
            {items.map((review) => (
              <ReviewItem key={review.id} review={review} />
            ))}
          </ol>
          {query.hasNextPage && (
            <div className="mt-8">
              <OutlineButton onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? "Loading…" : `Show more (${formatCount(total - items.length)} left)`}
              </OutlineButton>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// The left-hand box: a sign-in prompt for guests, the form for a user without a
// review, or a summary of their review with Edit and Delete.
function YourReview({ fragranceId, mine, ready }: { fragranceId: number; mine: Review | null; ready: boolean }) {
  const { user, loading } = useSession();
  const [editing, setEditing] = useState(false);
  let content;
  if (loading || (user && !ready)) content = <div className="skeleton h-[220px]" aria-hidden="true" />;
  else if (!user) content = <GuestPrompt />;
  else if (!mine || editing) {
    content = <ReviewForm key={mine?.id ?? "new"} fragranceId={fragranceId} existing={mine} onDone={() => setEditing(false)} />;
  } else content = <MineSummary fragranceId={fragranceId} mine={mine} onEdit={() => setEditing(true)} />;
  return <div className="self-start border border-line-strong bg-panel p-6 sm:p-8">{content}</div>;
}

function GuestPrompt() {
  return (
    <div>
      <p className="m-0 mb-6 font-display text-xl leading-snug text-soft">
        Wore it? Sign in to rate it from 1 to 5 stars and say how it wore.
      </p>
      <SignInPrompt label="Sign in to review" />
    </div>
  );
}

function MineSummary({ fragranceId, mine, onEdit }: { fragranceId: number; mine: Review; onEdit: () => void }) {
  const remove = useDeleteReview(fragranceId);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setError(null);
    try {
      await remove();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete your review. Try again.");
    }
  }

  const textButton = "cursor-pointer text-[10px] font-semibold tracking-label uppercase";
  return (
    <div>
      <p className="label-caps m-0 mb-3 text-[9px] font-semibold text-gold-kicker">Your review</p>
      <StarDisplay stars={mine.stars} size="large" />
      <p className="m-0 mt-3 text-xs text-dim">Posted {formatDate(mine.createdAt)}. It is listed with the others.</p>
      <div className="mt-6 flex flex-wrap items-center gap-5">
        {confirming ? (
          <>
            <span className="text-xs text-soft">Delete your review?</span>
            <button type="button" onClick={onDelete} className={`${textButton} text-chip-on-text hover:text-text-bright`}>
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={`${textButton} text-muted hover:text-text-bright`}>
              Keep it
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onEdit} className={`${textButton} text-gold-kicker hover:text-gold-bright`}>
              Edit
            </button>
            <button type="button" onClick={() => setConfirming(true)} className={`${textButton} text-muted hover:text-text-bright`}>
              Delete
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 mt-4 text-[12px] text-chip-on-text">
          {error}
        </p>
      )}
    </div>
  );
}

function ReviewItem({ review }: { review: Review }) {
  const edited = Date.parse(review.updatedAt) - Date.parse(review.createdAt) > EDIT_GRACE_MS;
  return (
    <li className="border-b border-line py-6">
      <article aria-label={`Review by ${review.authorName}`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StarDisplay stars={review.stars} />
          <span className="font-display text-lg text-text">{review.authorName}</span>
          {review.mine && <Tag tone="owned">You</Tag>}
          <span className="text-[10px] tracking-tag text-dim uppercase">
            <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
            {edited && " · Edited"}
          </span>
        </div>
        {/* Plain text: React escapes it. pre-line keeps the writer's line breaks. */}
        <p className="m-0 mt-3 font-display text-lg leading-snug [overflow-wrap:anywhere] whitespace-pre-line text-soft">
          {review.body}
        </p>
      </article>
    </li>
  );
}

function ReviewSkeleton() {
  return (
    <div className="border-t border-line-strong" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="border-b border-line py-6">
          <div className="skeleton h-4 w-56" />
          <div className="skeleton mt-4 h-12 w-full" />
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

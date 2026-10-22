import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { BottleImage } from "../../components/BottleImage";
import { FamilyTag, Tag } from "../../components/ui";
import type { ChatMessage, ChatRecommendation } from "../../lib/api";
import { useOwnedIds } from "../../lib/collection";

// The open chat's messages, in their own scrolling area inside the chat panel, so the
// page never grows with the conversation. Every message is rendered as text, never
// HTML, so whatever a visitor types or the server returns can't become markup.
export function MessageList({
  messages,
  pending,
  showHint,
}: {
  messages: ChatMessage[];
  pending: string | null;
  showHint: boolean; // the introduction and an example, only while the chat can take a message
}) {
  const { box, onScroll, behind, toBottom } = useStickToBottom(messages.length + (pending ? 1 : 0), pending !== null);
  return (
    <div className="relative min-h-0 flex-1">
      {/* `relative` makes this box the containing block of the absolutely positioned
          sr-only labels inside it; otherwise they escape the scroll clipping and
          stretch the page by the conversation's height. */}
      <div
        ref={box}
        onScroll={onScroll}
        className="@container relative h-full overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
      >
        {showHint && messages.length === 0 && pending === null && <Introduction />}
        {/* aria-live reads each new reply aloud for screen readers as it arrives. */}
        <ol aria-live="polite" className="m-0 grid list-none gap-5 p-0">
          {messages.map((message, index) => (
            <Message key={index} message={message} />
          ))}
          {pending !== null && (
            <>
              <Message message={{ role: "user", content: pending, recommendations: [] }} />
              <li role="status" className="font-display text-lg text-dim italic">
                Thinking…
              </li>
            </>
          )}
        </ol>
      </div>
      {behind && (
        <button
          type="button"
          onClick={toBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 cursor-pointer border border-gold-line bg-ink-raised px-4 py-2 text-[10px] font-semibold tracking-label text-chip-on-text uppercase hover:text-text-bright"
        >
          New messages ↓
        </button>
      )}
    </div>
  );
}

function Introduction() {
  return (
    <div className="mb-6 max-w-[540px]">
      <p className="m-0 mb-4 font-display text-xl leading-snug text-soft">
        Describe scents you love and ones you can't stand, in your own words. The assistant turns them into a taste
        profile, and Scense picks bottles from its catalogue to match.
      </p>
      <p className="m-0 font-display text-lg leading-snug text-dim">
        Try something like “I love the smell of a campfire and vanilla, but sharp lemony scents give me a headache.”
      </p>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <li className="ml-auto max-w-[85%] border border-line-control bg-sunken px-4 py-3">
        <span className="sr-only">You: </span>
        <p className="m-0 text-[14px] leading-relaxed whitespace-pre-line text-text-input">{message.content}</p>
      </li>
    );
  }
  return (
    <li className="max-w-[95%]">
      <span className="sr-only">Assistant: </span>
      <p className="m-0 font-display text-xl leading-snug whitespace-pre-line text-text">{message.content}</p>
      {message.recommendations.length > 0 && <Recommendations items={message.recommendations} />}
    </li>
  );
}

// The server's picks: owned bottles first, then new ones that suit you better.
function Recommendations({ items }: { items: ChatRecommendation[] }) {
  // The badge reads the visitor's collection now, so a bottle owned since shows it too.
  const owned = new Set(useOwnedIds());
  return (
    <div className="mt-4">
      <p className="kicker mb-3">Picked from the catalogue</p>
      {/* Three across once the conversation area, not the screen, is 36rem wide. */}
      <ul className="m-0 grid list-none gap-3 p-0 @xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 border border-line p-3">
            <Link to={`/f/${item.slug}`} tabIndex={-1} aria-hidden="true" className="block">
              <BottleImage src={item.imageUrl} family={item.dominantFamily} className="aspect-[3/4] w-full" lazy />
            </Link>
            <div className="min-w-0">
              <p className="kicker truncate">{item.brand}</p>
              <h3 className="mt-1 mb-2 line-clamp-2 font-display text-[19px] leading-[1.05] font-medium">
                <Link to={`/f/${item.slug}`} className="hover:text-gold-bright">
                  {item.name}
                </Link>
              </h3>
              <div className="flex flex-wrap gap-1.5">
                <FamilyTag family={item.dominantFamily} />
                {(item.owned || owned.has(item.id)) && <Tag tone="owned">Owned</Tag>}
                {item.match !== undefined && <Tag>{item.match}% match</Tag>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// How close to the bottom (in px) still counts as "at the bottom".
const NEAR_BOTTOM = 48;

// Keeps the newest message in view, unless the visitor has scrolled up to read earlier
// ones: then new messages wait below and a "New messages" button offers to jump down.
// Sending a message always scrolls down, since the visitor wants to see their own words.
// Only the conversation area scrolls; the page itself never moves.
function useStickToBottom(count: number, sending: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastCount = useRef(count);
  const [behind, setBehind] = useState(false);

  function toBottom() {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setBehind(false);
  }

  function onScroll() {
    const el = box.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    if (atBottom.current) setBehind(false);
  }

  // Layout effect: scroll before the browser paints, so the new message never flashes
  // in the wrong place. Opening a chat mounts this fresh, which lands on its last message.
  // The button only offers what is new: a failed send removes its pending message, which
  // shrinks the list and adds nothing to jump to.
  useLayoutEffect(() => {
    const grew = count > lastCount.current;
    lastCount.current = count;
    if (sending || atBottom.current) toBottom();
    else if (grew) setBehind(true);
  }, [count, sending]);

  return { box, onScroll, behind, toBottom };
}

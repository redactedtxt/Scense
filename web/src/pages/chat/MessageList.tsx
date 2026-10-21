import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { BottleImage } from "../../components/BottleImage";
import { FamilyTag, Tag } from "../../components/ui";
import type { ChatMessage, ChatRecommendation } from "../../lib/api";
import { useOwnedIds } from "../../lib/collection";

// The conversation so far. Every message is rendered as text, never HTML, so whatever
// a visitor types or the server returns can't become markup.
export function MessageList({
  messages,
  pending,
  showHint,
}: {
  messages: ChatMessage[];
  pending: string | null;
  showHint: boolean; // an example message, only while the chat can take one
}) {
  const end = useScrollToEnd(messages.length + (pending ? 1 : 0));
  return (
    <div className="mb-6">
      {showHint && messages.length === 0 && pending === null && (
        <p className="m-0 mb-6 max-w-[520px] font-display text-xl leading-snug text-soft">
          Try something like “I love the smell of a campfire and vanilla, but sharp lemony scents give me a headache.”
        </p>
      )}
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
      <div ref={end} />
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
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 border border-line p-3 sm:grid-cols-1">
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

// Keeps the newest message in view as the conversation grows.
function useScrollToEnd(dependency: unknown) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [dependency]);
  return end;
}

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

// Must match the API's CHAT_MESSAGE_MAX_CHARS (500), which refuses anything longer.
const MAX_CHARS = 500;

// The message box, the Send button, the day's count, and the disclaimer SPEC section 8
// asks for. It sits pinned at the bottom of the chat panel. `closedText` replaces the box
// when no chat can take another message. The count is the day's, shared by every chat.
export function ChatInput({
  onSend,
  busy,
  closedText,
  used,
  limit,
}: {
  onSend: (message: string) => Promise<boolean>;
  busy: boolean;
  closedText: string | null;
  used: number;
  limit: number;
}) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const message = draft.trim();

  async function submit() {
    if (message === "" || busy) return;
    setDraft("");
    // A failed send puts the words back, so nothing typed is lost.
    if (!(await onSend(message))) setDraft(message);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  // Enter sends, Shift+Enter starts a new line, as in most chat apps.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="border-t border-line-strong pt-4">
      {closedText ? (
        <p role="status" className="m-0 mb-3 font-display text-lg leading-snug text-chip-on-text">
          {closedText}
        </p>
      ) : (
        <form onSubmit={onSubmit} aria-label="Send a message">
          <label htmlFor={id} className="label-caps block text-[9px] font-semibold text-gold-kicker">
            Your message
          </label>
          <textarea
            id={id}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_CHARS}
            rows={2}
            placeholder="I like…"
            className="mt-2 w-full resize-none border border-line-input bg-transparent p-3 font-display text-lg text-text-input outline-0 transition-colors placeholder:text-faint focus:border-gold"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-dim tabular-nums">
              {used} of {limit} messages used today
              {/* Phones drop the character count so this line and Send share one row. */}
              <span className="hidden sm:inline"> · {MAX_CHARS - draft.length} characters left</span>
            </span>
            <button
              type="submit"
              disabled={busy || message === ""}
              className="h-[42px] cursor-pointer bg-gold-deep px-6 text-[10px] font-semibold tracking-label text-on-gold uppercase transition-colors hover:bg-gold disabled:cursor-default disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}
      <p className="m-0 mt-3 text-[11px] leading-snug text-dim">
        Up to {limit} messages a day, shared across all your chats. Recommendations come from our catalogue only.
      </p>
    </div>
  );
}

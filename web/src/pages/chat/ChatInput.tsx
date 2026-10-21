import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

// Must match the API's CHAT_MESSAGE_MAX_CHARS (500), which refuses anything longer.
const MAX_CHARS = 500;

// The message box, the Send button, the day's count, and the disclaimer SPEC section 8
// asks for. `closedText` replaces the box when the chat can't take another message.
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
    <div className="border-t border-line-strong pt-5">
      {closedText ? (
        <p role="status" className="m-0 mb-4 font-display text-lg leading-snug text-chip-on-text">
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
            rows={3}
            placeholder="I like…"
            className="mt-2 w-full resize-y border border-line-input bg-transparent p-3 font-display text-lg text-text-input outline-0 transition-colors placeholder:text-faint focus:border-gold"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-dim tabular-nums">
              {used} of {limit} messages used today · {MAX_CHARS - draft.length} characters left
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
      <p className="m-0 mt-4 text-[11px] leading-snug text-dim">
        You get one chat per day, up to 8 messages. Recommendations come from our catalogue only.
      </p>
    </div>
  );
}

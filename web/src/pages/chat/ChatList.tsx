import { useEffect, useState } from "react";
import type { ChatSummary } from "../../lib/api";

// What the list calls its conversations. The concierge passes its own ("outings").
export type ListWords = {
  heading: string;
  empty: string;
  deleteLabel: string; // + ": <title>", for screen readers
  confirm: string;
  retention: string;
};

export const CHAT_WORDS: ListWords = {
  heading: "Your chats",
  empty: "No chats yet. Your chats appear here after your first message.",
  deleteLabel: "Delete chat",
  confirm: "Delete this chat?",
  retention: "Chats are deleted 30 days after their last message.",
};

// The visitor's chats (or concierge outings), most recently used first (DECISIONS B36,
// B37). From 1280px it is the panel's left column; below that it opens over the
// conversation from the panel bar's button. Titles are the visitor's own first
// messages, shown as text.
export function ChatList({
  chats,
  activeId,
  open,
  busyChatId,
  onOpen,
  onClose,
  onDelete,
  listId = "chat-list",
  words = CHAT_WORDS,
}: {
  chats: ChatSummary[];
  activeId: string | null;
  open: boolean;
  busyChatId: string | null; // the chat with a message in flight can't be deleted
  onOpen: (id: string | null) => void;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  listId?: string;
  words?: ListWords;
}) {
  // Escape closes the list where it covers the conversation.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <nav
      id={listId}
      aria-label={words.heading}
      className={`${open ? "absolute inset-0 z-10 flex" : "hidden"} min-h-0 flex-col bg-panel xl:static xl:flex xl:border-r xl:border-line`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 xl:min-h-[66px]">
        <p className="kicker">{words.heading}</p>
        <button type="button" onClick={onClose} className="cursor-pointer text-[11px] text-muted hover:text-text-bright xl:hidden">
          Close
        </button>
      </div>
      {chats.length === 0 ? (
        <p className="m-0 px-4 py-4 text-[13px] leading-snug text-dim">{words.empty}</p>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
          {chats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={chat.id === activeId}
              busy={chat.id === busyChatId}
              onOpen={() => onOpen(chat.id)}
              onDelete={() => onDelete(chat.id)}
              words={words}
            />
          ))}
        </ul>
      )}
      <p className="m-0 shrink-0 border-t border-line px-4 py-3 text-[10px] leading-snug text-dim">
        {words.retention}
      </p>
    </nav>
  );
}

function ChatRow({
  chat,
  active,
  busy,
  onOpen,
  onDelete,
  words,
}: {
  chat: ChatSummary;
  active: boolean;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  words: ListWords;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    setFailed(false);
    try {
      await onDelete();
    } catch {
      setFailed(true);
      setDeleting(false);
    }
  }

  return (
    <li className={`border-b border-line border-l-2 ${active ? "border-l-gold bg-sunken" : "border-l-transparent"}`}>
      <div className="flex items-start gap-2 px-3 py-3">
        <button
          type="button"
          onClick={onOpen}
          aria-current={active ? "true" : undefined}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <span className="block truncate text-[13px] leading-snug text-text-input">{chat.title}</span>
          <time dateTime={chat.lastMessageAt} className="mt-1 block text-[11px] text-dim">
            {chatDate(chat.lastMessageAt)}
          </time>
        </button>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            aria-label={`${words.deleteLabel}: ${chat.title}`}
            className="h-6 w-6 shrink-0 cursor-pointer text-[16px] leading-none text-dim transition-colors hover:text-text-bright disabled:cursor-default disabled:opacity-40"
          >
            ×
          </button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-3 px-3 pb-3 text-[11px]">
          <span className="text-chip-on-text">{failed ? "That didn't delete. Try again?" : words.confirm}</span>
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={deleting}
            className="cursor-pointer font-semibold tracking-label text-gold-bright uppercase hover:text-text-bright disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="cursor-pointer tracking-label text-muted uppercase hover:text-text-bright"
          >
            Keep
          </button>
        </div>
      )}
    </li>
  );
}

// "Today", "Yesterday", "Oct 14", or "Oct 14, 2025", in the visitor's own time zone.
export function chatDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

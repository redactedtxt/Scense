import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  api,
  ApiError,
  type ConciergeMessage,
  type ConciergeOuting,
  type ConciergeReply,
  type ConciergeState,
} from "../lib/api";
import { useOwnedIds } from "../lib/collection";
import { getState } from "../lib/guestStore";
import { conciergeKey, conciergeOutingKey, useSession } from "../lib/session";
import { ChatInput } from "./chat/ChatInput";
import { ChatList, type ListWords } from "./chat/ChatList";
import { MessageList } from "./chat/MessageList";
import { GRID_HEIGHT, PANEL_HEIGHT, PanelBar } from "./chat/PanelBar";
import { AnswerChips } from "./concierge/AnswerChips";
import { OutingCard } from "./concierge/OutingCard";
import { PickCards } from "./concierge/PickCards";

export const CONCIERGE_UNAVAILABLE_TEXT =
  "The concierge is unavailable right now. Everything else on Scense works as usual, so try again later.";

export const OUTING_GONE_TEXT = "That outing is gone. It may have been deleted, or it expired.";

const LIST_WORDS: ListWords = {
  heading: "Your outings",
  empty: "No outings yet. Your outings appear here after your first message.",
  deleteLabel: "Delete outing",
  confirm: "Delete this outing?",
  retention: "Outings are deleted 30 days after their last message.",
};

const LIST_ID = "outing-list";

// /concierge (SPEC sections 9 and 11; DECISIONS B37): describe an outing, answer the
// questions for anything missing (tap a chip or type), and the server picks what to wear
// from your Own list. The same panel as the chat: fixed height, its own scroll, the input
// pinned at the bottom, and several outings in a list. The open one is in the URL
// (?o=<id>); no id is a new outing.
export function ConciergePage() {
  const session = useSession();
  return (
    <>
      <title>Concierge · Scense</title>
      {session.loading ? <Loading /> : <Workspace userId={session.user?.id ?? null} />}
    </>
  );
}

function Loading() {
  return (
    <p
      role="status"
      className="m-0 min-h-[calc(100dvh-var(--spacing-header-sm))] py-10 font-display text-xl text-soft sm:min-h-[calc(100dvh-var(--spacing-header))]"
    >
      Loading your outings…
    </p>
  );
}

type Pending = { outingId: string | null; text: string };

function Workspace({ userId }: { userId: number | null }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("o");
  const list = useQuery({ queryKey: conciergeKey(userId), queryFn: api.concierge, staleTime: Infinity });
  const owned = useOwnedIds();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  function openOuting(id: string | null) {
    setParams(id ? { o: id } : {});
    setError(null);
    setListOpen(false);
  }

  async function send(message: string): Promise<boolean> {
    const outingId = activeId;
    setPending({ outingId, text: message });
    setError(null);
    try {
      // A guest's Own list (the candidates) and taste profile live in the browser.
      const guest = userId === null ? { tasteProfile: getState().tasteProfile, owned } : {};
      const reply = await api.sendConcierge({ message, conversationId: outingId ?? undefined, ...guest });
      storeReply(client, userId, message, reply);
      if (outingId === null) {
        setParams((now) => (now.get("o") ? now : new URLSearchParams({ o: reply.conversation.id })), { replace: true });
      }
      return true;
    } catch (err) {
      handleSendError(err);
      return false;
    } finally {
      setPending(null);
    }
  }

  function handleSendError(err: unknown) {
    if (err instanceof ApiError && err.status === 429) {
      setClosed(err.message);
    } else if (err instanceof ApiError && err.status === 503) {
      setError(CONCIERGE_UNAVAILABLE_TEXT);
    } else if (err instanceof ApiError && err.code === "no_outing") {
      setError(OUTING_GONE_TEXT);
      void client.invalidateQueries({ queryKey: conciergeKey(userId) });
    } else {
      setError(err instanceof ApiError && err.status < 500 ? err.message : "That didn't send. Try again in a moment.");
    }
  }

  async function deleteOuting(id: string) {
    await api.deleteOuting(id);
    client.setQueryData<ConciergeState>(conciergeKey(userId), (old) =>
      old ? { ...old, conversations: old.conversations.filter((c) => c.id !== id) } : old,
    );
    client.removeQueries({ queryKey: conciergeOutingKey(userId, id) });
    if (id === activeId) openOuting(null);
  }

  if (list.isPending) return <Loading />;
  const state = list.data ?? { available: false, messagesUsed: 0, messagesLimit: 8, conversations: [] };
  const used = state.messagesUsed >= state.messagesLimit;
  const closedText = !state.available
    ? CONCIERGE_UNAVAILABLE_TEXT
    : (closed ??
      (used ? "You've used today's typed messages. You can still tap an answer; for more typing, come back tomorrow." : null));
  const activeTitle = state.conversations.find((c) => c.id === activeId)?.title ?? (activeId ? "Outing" : "New outing");
  // A chip sends its label as the message. Chip answers are free (DECISIONS B38), so they
  // keep working after today's typed messages are used; only an unavailable concierge or
  // a reply on its way disables them.
  const onChip = state.available && pending === null ? (label: string) => void send(label) : null;

  return (
    <div className={`grid gap-6 py-3 sm:py-5 md:grid-cols-[minmax(0,1fr)_minmax(270px,330px)] md:gap-8 ${GRID_HEIGHT}`}>
      <section
        aria-label="Concierge"
        className={`relative flex min-h-[420px] min-w-0 flex-col border border-line-strong bg-panel md:min-h-0 xl:grid xl:grid-cols-[230px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)] ${PANEL_HEIGHT}`}
      >
        <ChatList
          chats={state.conversations}
          activeId={activeId}
          open={listOpen}
          busyChatId={pending ? (pending.outingId ?? "") : null}
          onOpen={openOuting}
          onClose={() => setListOpen(false)}
          onDelete={deleteOuting}
          listId={LIST_ID}
          words={LIST_WORDS}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PanelBar
            title={activeTitle}
            chatCount={state.conversations.length}
            listOpen={listOpen}
            onToggleList={() => setListOpen((open) => !open)}
            onNewChat={() => openOuting(null)}
            newChatDisabled={activeId === null}
            words={{ kicker: "Concierge", list: "Outings", newOne: "New outing" }}
            listId={LIST_ID}
          />
          {activeId === null ? (
            <MessageList<ConciergeMessage>
              key="new"
              messages={[]}
              pending={pending?.outingId === null ? pending.text : null}
              showHint={closedText === null}
              introduction={<Introduction ownedCount={owned.length} />}
            />
          ) : (
            <OpenOuting key={activeId} userId={userId} id={activeId} pending={pending} showHint={closedText === null} onChip={onChip} />
          )}
          <div className="shrink-0 px-4 pb-4 sm:px-6 sm:pb-5">
            {error && (
              <p role="alert" className="m-0 mb-3 border-l-2 border-gold-line pl-3 text-[13px] leading-snug text-chip-on-text">
                {error}
              </p>
            )}
            <ChatInput
              onSend={send}
              busy={pending !== null}
              closedText={closedText}
              used={state.messagesUsed}
              limit={state.messagesLimit}
              placeholder="Dinner at 8, a first date…"
              disclaimer={`Up to ${state.messagesLimit} typed messages a day, shared across all your outings; tapping an answer is free. Picks come from your Own list, or from our catalogue when it's empty.`}
            />
          </div>
        </div>
      </section>
      <div className="md:min-h-0 md:overflow-y-auto">
        <OutingCard userId={userId} outingId={activeId} ownedCount={owned.length} />
      </div>
    </div>
  );
}

function Introduction({ ownedCount }: { ownedCount: number }) {
  return (
    <div className="mb-6 max-w-[540px]">
      <p className="m-0 mb-4 font-display text-xl leading-snug text-soft">
        Tell the concierge where you're going, in your own words. It asks for anything it still needs, then picks what
        to wear from your Own list{ownedCount === 0 ? ", or from the whole catalogue while that list is empty" : ""}.
      </p>
      <p className="m-0 font-display text-lg leading-snug text-dim">
        Try something like “Date night, dinner at 8 on a restaurant patio, and I want to be noticed.”
      </p>
    </div>
  );
}

// One saved outing's messages, loaded when it is opened. The latest question's chips
// are the only ones that can be tapped.
function OpenOuting({
  userId,
  id,
  pending,
  showHint,
  onChip,
}: {
  userId: number | null;
  id: string;
  pending: Pending | null;
  showHint: boolean;
  onChip: ((label: string) => void) | null;
}) {
  const outing = useQuery({
    queryKey: conciergeOutingKey(userId, id),
    queryFn: () => api.conciergeOuting(id),
    staleTime: Infinity,
  });
  if (outing.isPending) {
    return (
      <p role="status" className="m-0 flex-1 px-4 py-6 font-display text-lg text-soft sm:px-6">
        Loading this outing…
      </p>
    );
  }
  if (outing.isError) {
    const gone = outing.error instanceof ApiError && outing.error.status === 404;
    return (
      <p role="status" className="m-0 flex-1 px-4 py-6 font-display text-lg leading-snug text-soft sm:px-6">
        {gone ? `${OUTING_GONE_TEXT} Start a new outing to keep going.` : "This outing didn't load. Try again in a moment."}
      </p>
    );
  }
  const messages = outing.data.messages;
  const last = messages.length - 1;
  return (
    <MessageList<ConciergeMessage>
      messages={messages}
      pending={pending?.outingId === id ? pending.text : null}
      showHint={showHint}
      renderBelow={(message, index) => (
        <>
          {message.picks.length > 0 && <PickCards picks={message.picks} />}
          {index === last && message.role === "assistant" && message.options.length > 0 && pending === null && (
            <AnswerChips options={message.options} onPick={onChip} />
          )}
        </>
      )}
    />
  );
}

// Puts a reply in the cache: both messages and the new slots into its outing, and the
// outing to the top of the list with the day's new count, so nothing needs refetching.
function storeReply(client: QueryClient, userId: number | null, message: string, reply: ConciergeReply) {
  const added: ConciergeMessage[] = [
    { role: "user", content: message, options: [], picks: [] },
    { role: "assistant", content: reply.reply, options: reply.options, picks: reply.picks },
  ];
  client.setQueryData<ConciergeOuting>(conciergeOutingKey(userId, reply.conversation.id), (old) => ({
    conversation: reply.conversation,
    outing: reply.outing,
    messages: [...(old?.messages ?? []), ...added],
  }));
  client.setQueryData<ConciergeState>(conciergeKey(userId), (old) => {
    const others = (old?.conversations ?? []).filter((c) => c.id !== reply.conversation.id);
    return {
      available: old?.available ?? true,
      messagesUsed: reply.messagesUsed,
      messagesLimit: reply.messagesLimit,
      conversations: [reply.conversation, ...others],
    };
  });
}

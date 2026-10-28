import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useSearchParams } from "react-router";
import { TasteProfileCard } from "../components/TasteProfileCard";
import { api, ApiError, type ChatConversation, type ChatMessage, type ChatReply, type ChatState } from "../lib/api";
import { useOwnedIds } from "../lib/collection";
import { getState } from "../lib/guestStore";
import { chatConversationKey, chatKey, useSession } from "../lib/session";
import { storeChatProfile } from "../lib/taste";
import { ChatInput } from "./chat/ChatInput";
import { ChatList } from "./chat/ChatList";
import { MessageList } from "./chat/MessageList";
import { GRID_HEIGHT, PANEL_HEIGHT, PanelBar } from "./chat/PanelBar";

export const UNAVAILABLE_TEXT =
  "The assistant is unavailable right now. Everything else on Scense works as usual, so try the chat again later.";

export const CHAT_GONE_TEXT = "That chat is gone. It may have been deleted, or it expired.";

// /chat (SPEC sections 8 and 11): describe what you like, the AI turns it into a taste
// profile, and the server recommends from the catalogue. A visitor keeps several chats
// (DECISIONS B36); the open one is in the URL (?c=<id>), and no id means a new chat.
export function ChatPage() {
  const session = useSession();
  return (
    <>
      <title>Chat · Scense</title>
      {/* Wait for the session: the chats belong to the account or the guest. */}
      {session.loading ? <Loading /> : <Workspace userId={session.user?.id ?? null} />}
    </>
  );
}

// Takes the panel's full height, so the footer doesn't jump when the panel arrives.
function Loading() {
  return (
    <p
      role="status"
      className="m-0 min-h-[calc(100dvh-var(--spacing-header-sm))] py-10 font-display text-xl text-soft sm:min-h-[calc(100dvh-var(--spacing-header))]"
    >
      Loading your chats…
    </p>
  );
}

type Pending = { chatId: string | null; text: string };

function Workspace({ userId }: { userId: number | null }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c");
  const list = useQuery({ queryKey: chatKey(userId), queryFn: api.chat, staleTime: Infinity });
  const owned = useOwnedIds();
  // The one message in flight, and the chat it went to (the server takes one at a time).
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set by a 429 (today's messages used, or the guest cap): the input stays closed.
  const [closed, setClosed] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  function openChat(id: string | null) {
    setParams(id ? { c: id } : {});
    setError(null);
    setListOpen(false);
  }

  async function send(message: string): Promise<boolean> {
    const chatId = activeId;
    setPending({ chatId, text: message });
    setError(null);
    try {
      // A guest's profile and Own list live in the browser, so they travel with the
      // message; a user's are read from the account by the server.
      const guest = userId === null ? { tasteProfile: getState().tasteProfile, owned } : {};
      const reply = await api.sendChat({ message, conversationId: chatId ?? undefined, ...guest });
      storeChatProfile(client, userId !== null, reply.profile);
      storeReply(client, userId, message, reply);
      // A new chat now has an id. Put it in the URL, unless the visitor has meanwhile
      // opened another chat.
      if (chatId === null) {
        setParams((now) => (now.get("c") ? now : new URLSearchParams({ c: reply.conversation.id })), { replace: true });
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
      setError(UNAVAILABLE_TEXT);
    } else if (err instanceof ApiError && err.code === "no_chat") {
      setError(CHAT_GONE_TEXT);
      void client.invalidateQueries({ queryKey: chatKey(userId) });
    } else {
      setError(err instanceof ApiError && err.status < 500 ? err.message : "That didn't send. Try again in a moment.");
    }
  }

  async function deleteChat(id: string) {
    await api.deleteChat(id);
    client.setQueryData<ChatState>(chatKey(userId), (old) =>
      old ? { ...old, conversations: old.conversations.filter((c) => c.id !== id) } : old,
    );
    client.removeQueries({ queryKey: chatConversationKey(userId, id) });
    if (id === activeId) openChat(null);
  }

  if (list.isPending) return <Loading />;
  // If even the list fails to load, the API or database is down: say the friendly thing.
  const state = list.data ?? { available: false, messagesUsed: 0, messagesLimit: 8, conversations: [] };
  const used = state.messagesUsed >= state.messagesLimit;
  const closedText = !state.available
    ? UNAVAILABLE_TEXT
    : (closed ?? (used ? "You've used today's messages. Come back tomorrow for more; your chats stay here to read." : null));
  const activeTitle = state.conversations.find((c) => c.id === activeId)?.title ?? (activeId ? "Chat" : "New chat");

  return (
    <div className={`grid gap-6 py-3 sm:py-5 md:grid-cols-[minmax(0,1fr)_minmax(270px,330px)] md:gap-8 ${GRID_HEIGHT}`}>
      <section
        aria-label="Chat"
        className={`relative flex min-h-[420px] min-w-0 flex-col border border-line-strong bg-panel md:min-h-0 xl:grid xl:grid-cols-[230px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)] ${PANEL_HEIGHT}`}
      >
        <ChatList
          chats={state.conversations}
          activeId={activeId}
          open={listOpen}
          busyChatId={pending ? (pending.chatId ?? "") : null}
          onOpen={openChat}
          onClose={() => setListOpen(false)}
          onDelete={deleteChat}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PanelBar
            title={activeTitle}
            chatCount={state.conversations.length}
            listOpen={listOpen}
            onToggleList={() => setListOpen((open) => !open)}
            onNewChat={() => openChat(null)}
            newChatDisabled={activeId === null}
            words={{ kicker: "Taste chat", list: "Chats", newOne: "New chat" }}
            listId="chat-list"
          />
          {activeId === null ? (
            <MessageList
              key="new"
              messages={[]}
              pending={pending?.chatId === null ? pending.text : null}
              showHint={closedText === null}
            />
          ) : (
            <OpenChat key={activeId} userId={userId} id={activeId} pending={pending} showHint={closedText === null} />
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
            />
          </div>
        </div>
      </section>
      <ProfileColumn />
    </div>
  );
}

// One saved chat's messages, loaded when it is opened.
function OpenChat({ userId, id, pending, showHint }: { userId: number | null; id: string; pending: Pending | null; showHint: boolean }) {
  const chat = useQuery({
    queryKey: chatConversationKey(userId, id),
    queryFn: () => api.chatConversation(id),
    staleTime: Infinity,
  });
  if (chat.isPending) {
    return (
      <p role="status" className="m-0 flex-1 px-4 py-6 font-display text-lg text-soft sm:px-6">
        Loading this chat…
      </p>
    );
  }
  if (chat.isError) {
    const gone = chat.error instanceof ApiError && chat.error.status === 404;
    return (
      <p role="status" className="m-0 flex-1 px-4 py-6 font-display text-lg leading-snug text-soft sm:px-6">
        {gone ? `${CHAT_GONE_TEXT} Start a new chat to keep going.` : "This chat didn't load. Try again in a moment."}
      </p>
    );
  }
  return (
    <MessageList messages={chat.data.messages} pending={pending?.chatId === id ? pending.text : null} showHint={showHint} />
  );
}

// The taste profile is shared by every chat. From 901px it sits beside the panel and
// scrolls on its own; on phones it sits below the panel, folded away until asked for.
function ProfileColumn() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="md:min-h-0 md:overflow-y-auto">
      <button
        type="button"
        onClick={() => setOpen((now) => !now)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full cursor-pointer items-center justify-between border border-line-strong bg-panel px-5 py-4 text-left md:hidden"
      >
        <span className="kicker">Your taste profile</span>
        <span aria-hidden="true" className="text-gold-icon">
          {open ? "−" : "+"}
        </span>
      </button>
      <div id={id} className={`${open ? "block" : "hidden"} mt-3 md:mt-0 md:block`}>
        <TasteProfileCard />
      </div>
    </div>
  );
}

// Puts a reply in the cache: both messages into its chat, and the chat to the top of the
// list with the day's new count, so nothing needs refetching.
function storeReply(client: QueryClient, userId: number | null, message: string, reply: ChatReply) {
  const added: ChatMessage[] = [
    { role: "user", content: message, recommendations: [] },
    { role: "assistant", content: reply.reply, recommendations: reply.recommendations },
  ];
  client.setQueryData<ChatConversation>(chatConversationKey(userId, reply.conversation.id), (old) => ({
    conversation: reply.conversation,
    messages: [...(old?.messages ?? []), ...added],
    budget: reply.budget,
  }));
  client.setQueryData<ChatState>(chatKey(userId), (old) => {
    const others = (old?.conversations ?? []).filter((c) => c.id !== reply.conversation.id);
    return {
      available: old?.available ?? true,
      messagesUsed: reply.messagesUsed,
      messagesLimit: reply.messagesLimit,
      conversations: [reply.conversation, ...others],
    };
  });
}

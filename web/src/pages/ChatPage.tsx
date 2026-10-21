import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TasteProfileCard } from "../components/TasteProfileCard";
import { api, ApiError, type ChatMessage, type ChatState } from "../lib/api";
import { useOwnedIds } from "../lib/collection";
import { getState } from "../lib/guestStore";
import { chatKey, useSession } from "../lib/session";
import { storeChatProfile } from "../lib/taste";
import { ChatInput } from "./chat/ChatInput";
import { MessageList } from "./chat/MessageList";

export const UNAVAILABLE_TEXT =
  "The assistant is unavailable right now. Everything else on Scense works as usual, so try the chat again later.";

// /chat (SPEC sections 8 and 11): describe what you like, the AI turns it into a taste
// profile, and the server recommends from the catalogue. Today's conversation comes
// from the server, so a reload brings it back (DECISIONS B34).
export function ChatPage() {
  const session = useSession();
  return (
    <>
      <title>Chat · Scense</title>
      <section className="pt-[58px] pb-10 sm:pt-[72px] sm:pb-12">
        <p className="kicker">Taste chat</p>
        <h1 className="mt-4 mb-5 font-display text-[54px] leading-[0.88] font-medium tracking-display sm:text-[clamp(54px,6.2vw,88px)]">
          Say what you <em className="font-normal text-gold-pale">like.</em>
        </h1>
        <p className="m-0 max-w-[485px] font-display text-lg leading-[1.45] text-soft sm:text-xl">
          Describe scents you love and ones you can't stand, in your own words. The assistant turns them into a taste
          profile, and Scense picks bottles from its catalogue to match.
        </p>
      </section>
      <div className="grid gap-10 pb-24 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] md:items-start md:gap-[4vw]">
        {/* Wait for the session: the conversation belongs to the account or the guest. */}
        {session.loading ? <Loading /> : <Conversation userId={session.user?.id ?? null} />}
        <div className="md:sticky md:top-6">
          <TasteProfileCard />
        </div>
      </div>
    </>
  );
}

function Loading() {
  return (
    <p role="status" className="m-0 font-display text-xl text-soft">
      Loading today's chat…
    </p>
  );
}

function Conversation({ userId }: { userId: number | null }) {
  const client = useQueryClient();
  const key = chatKey(userId);
  const chat = useQuery({ queryKey: key, queryFn: api.chat, staleTime: Infinity });
  const owned = useOwnedIds();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set by a 429 (today's chat used, or the guest cap): the input stays closed.
  const [closed, setClosed] = useState<string | null>(null);

  async function send(message: string): Promise<boolean> {
    setPending(message);
    setError(null);
    try {
      // A guest's profile and Own list live in the browser, so they travel with the
      // message; a user's are read from the account by the server.
      const body = userId === null ? { message, tasteProfile: getState().tasteProfile, owned } : { message };
      const reply = await api.sendChat(body);
      storeChatProfile(client, userId !== null, reply.profile);
      client.setQueryData<ChatState>(key, (old) => appendExchange(old, message, reply));
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
    } else {
      setError(err instanceof ApiError && err.status < 500 ? err.message : "That didn't send. Try again in a moment.");
    }
  }

  if (chat.isPending) return <Loading />;
  // If even loading the chat fails, the API or database is down: say the friendly thing.
  const state = chat.data ?? { available: false, messagesUsed: 0, messagesLimit: 8, messages: [] };
  const used = state.messagesUsed >= state.messagesLimit;
  const closedText = !state.available ? UNAVAILABLE_TEXT : (closed ?? (used ? "You've used today's chat. Come back tomorrow for another." : null));

  return (
    <section aria-label="Chat" className="min-w-0">
      <MessageList messages={state.messages} pending={pending} showHint={closedText === null} />
      {error && (
        <p role="alert" className="m-0 mb-4 border-l-2 border-gold-line pl-3 text-[13px] leading-snug text-chip-on-text">
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
    </section>
  );
}

function appendExchange(old: ChatState | undefined, message: string, reply: Awaited<ReturnType<typeof api.sendChat>>): ChatState {
  const base = old ?? { available: true, messagesUsed: 0, messagesLimit: reply.messagesLimit, messages: [] };
  const added: ChatMessage[] = [
    { role: "user", content: message, recommendations: [] },
    { role: "assistant", content: reply.reply, recommendations: reply.recommendations },
  ];
  return { ...base, messagesUsed: reply.messagesUsed, messagesLimit: reply.messagesLimit, messages: [...base.messages, ...added] };
}

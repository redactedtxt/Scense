import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ChatMessage } from "../lib/api";
import { MessageList } from "../pages/chat/MessageList";

// The chat panel's own scrolling (DECISIONS B36). jsdom does no layout, so each test
// gives the scroll box fixed sizes: 1,000px of content in a 300px window.

const say = (n: number): ChatMessage[] => [
  { role: "user", content: `question ${n}`, recommendations: [] },
  { role: "assistant", content: `answer ${n}`, recommendations: [] },
];

function renderList(messages: ChatMessage[], pending: string | null = null) {
  const view = render(
    <MemoryRouter>
      <MessageList messages={messages} pending={pending} showHint={false} />
    </MemoryRouter>,
  );
  const rerender = (next: ChatMessage[], nextPending: string | null = null) =>
    view.rerender(
      <MemoryRouter>
        <MessageList messages={next} pending={nextPending} showHint={false} />
      </MemoryRouter>,
    );
  return { rerender };
}

// Sizes the scroll box like a real one: content taller than the window.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

const scrollBox = () => screen.getByRole("list").parentElement as HTMLElement;

function scrollTo(top: number) {
  scrollBox().scrollTop = top;
  scrollBox().dispatchEvent(new Event("scroll"));
}

describe("the message list's scrolling", () => {
  it("opens on the last message and follows new ones while the visitor is at the bottom", () => {
    const { rerender } = renderList([...say(1), ...say(2)]);
    expect(scrollBox().scrollTop).toBe(1000);
    scrollTo(700); // the bottom: 1000 - 700 - 300 = 0
    rerender([...say(1), ...say(2), ...say(3)]);
    expect(scrollBox().scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /New messages/ })).not.toBeInTheDocument();
  });

  it("stays put when the visitor has scrolled up, and offers a jump to the new message", async () => {
    const { rerender } = renderList([...say(1), ...say(2)]);
    scrollTo(100);
    rerender([...say(1), ...say(2), ...say(3)]);
    expect(scrollBox().scrollTop).toBe(100);
    await userEvent.click(screen.getByRole("button", { name: /New messages/ }));
    expect(scrollBox().scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /New messages/ })).not.toBeInTheDocument();
  });

  it("always scrolls down to the visitor's own message, and a failed send offers nothing new", () => {
    const { rerender } = renderList(say(1));
    scrollTo(100);
    rerender(say(1), "my question");
    expect(scrollBox().scrollTop).toBe(1000);
    scrollTo(100);
    rerender(say(1)); // the send failed: the pending message goes away
    expect(scrollBox().scrollTop).toBe(100);
    expect(screen.queryByRole("button", { name: /New messages/ })).not.toBeInTheDocument();
  });
});

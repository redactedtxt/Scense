import { ListIcon, PlusIcon } from "../../components/Icons";

// The conversation panel's frame, shared by the chat and the concierge (DECISIONS B36,
// B37): the same heights and the same top bar.

// The panel fills the screen under the header: 100dvh, so it shrinks with the mobile
// browser's toolbars (and with the keyboard on Android, see index.html), minus the header
// and the page's own vertical padding (12px a side on phones, 20px from 641px). From
// 901px the grid row takes that height and the panel fills the row.
export const PANEL_HEIGHT =
  "h-[calc(100dvh-var(--spacing-header-sm)-24px)] sm:h-[calc(100dvh-var(--spacing-header)-40px)] md:h-auto";
export const GRID_HEIGHT = "md:h-[calc(100dvh-var(--spacing-header))] md:grid-rows-[minmax(0,1fr)]";

export type PanelWords = {
  kicker: string; // "Taste chat"
  list: string; // the list button below 1280px: "Chats"
  newOne: string; // "New chat"
};

// The strip across the top of the panel: the open conversation's title, the "new" button,
// and below 1280px the button that opens the list over the conversation. Below 641px both
// buttons shrink to icons (the list one keeps its count), so the title has room; their
// accessible names stay the full words.
export function PanelBar({
  title,
  chatCount,
  listOpen,
  onToggleList,
  onNewChat,
  newChatDisabled,
  words,
  listId,
}: {
  title: string;
  chatCount: number;
  listOpen: boolean;
  onToggleList: () => void;
  onNewChat: () => void;
  newChatDisabled: boolean;
  words: PanelWords;
  listId: string;
}) {
  const listName = `${words.list}${chatCount > 0 ? ` (${chatCount})` : ""}`;
  const buttonStyle =
    "inline-flex h-[34px] min-w-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 border border-line-control px-2 text-[10px] sm:px-3 font-semibold tracking-label text-muted uppercase transition-colors hover:border-gold-deep hover:text-text-bright disabled:cursor-default disabled:opacity-50";
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
      <button
        type="button"
        onClick={onToggleList}
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-label={listName}
        className={`${buttonStyle} xl:hidden`}
      >
        <ListIcon className="sm:hidden" />
        {chatCount > 0 && <span className="tabular-nums sm:hidden">{chatCount}</span>}
        <span className="hidden sm:inline">{listName}</span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="kicker text-[9px]">{words.kicker}</p>
        <h1 className="m-0 mt-1 truncate font-display text-[21px] leading-tight font-medium" title={title}>
          {title}
        </h1>
      </div>
      <button type="button" onClick={onNewChat} disabled={newChatDisabled} aria-label={words.newOne} className={buttonStyle}>
        <PlusIcon className="sm:hidden" />
        <span className="hidden sm:inline">{words.newOne}</span>
      </button>
    </div>
  );
}

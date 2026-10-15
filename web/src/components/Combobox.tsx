import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { SearchIcon } from "./Icons";

type Props<T> = {
  label: string;
  placeholder?: string;
  value: string;
  onValueChange: (text: string) => void;
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  loading?: boolean;
  // Shown when the text is long enough to search but nothing matched.
  emptyText?: string;
  onFocus?: () => void;
  trailing?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  size?: "large" | "small";
};

// A search box with a suggestion list, following the WAI-ARIA combobox pattern:
// focus stays in the input, arrow keys move a highlighted option, Enter picks it,
// Escape closes the list. Screen readers follow the highlight through
// aria-activedescendant.
export function Combobox<T>({ inputRef, ...props }: Props<T>) {
  const { label, value, items, itemKey, onSelect, size = "large" } = props;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const showList = open && value.trim() !== "" && (items.length > 0 || !props.loading);

  function pick(item: T) {
    onSelect(item);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (items.length ? (current + step + items.length) % items.length : -1));
    } else if (event.key === "Enter" && showList) {
      const chosen = items[active] ?? items[0];
      if (chosen) {
        event.preventDefault();
        pick(chosen);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`;
  const large = size === "large";

  return (
    <div className="relative">
      <div
        className={`grid items-center gap-[13px] border-b border-line-input ${
          large ? "min-h-[54px] grid-cols-[22px_1fr_26px]" : "min-h-[46px] grid-cols-[20px_1fr] gap-3"
        }`}
      >
        <SearchIcon />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={props.placeholder}
          value={value}
          onChange={(event) => {
            props.onValueChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            setOpen(true);
            props.onFocus?.();
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={`w-full min-w-0 border-0 bg-transparent font-display text-text-input outline-0 placeholder:text-faint ${
            large ? "text-xl" : "text-[17px]"
          }`}
        />
        {props.trailing}
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!showList}
        className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[320px] overflow-y-auto border border-line-strong bg-panel py-1 shadow-[0_25px_70px_rgba(0,0,0,0.45)]"
      >
        {items.map((item, index) => (
          <li
            key={itemKey(item)}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            // mousedown, not click: picking must happen before the input's blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault();
              pick(item);
            }}
            onMouseEnter={() => setActive(index)}
            className={`cursor-pointer px-4 py-2.5 ${index === active ? "bg-chip-on" : ""}`}
          >
            {props.renderItem(item)}
          </li>
        ))}
        {items.length === 0 && !props.loading && (
          <li role="presentation" className="px-4 py-2.5 text-xs text-dim">
            {props.emptyText ?? "No matches."}
          </li>
        )}
      </ul>
    </div>
  );
}

// One suggestion row: name in the display face, a small grey line under it.
export function SuggestionRow({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="block">
      <span className="block font-display text-[17px] text-text">{title}</span>
      <span className="block text-[10px] tracking-[0.04em] text-dim">{detail}</span>
    </span>
  );
}

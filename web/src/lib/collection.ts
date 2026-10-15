// The guest's Own list. M5 (guest mode) fills this from localStorage; until then
// nobody owns anything, so "Owned" badges stay hidden and "Owned only" shows its
// empty state. Pages read owned IDs only through this hook so M5 changes one file.
const NO_OWNED: number[] = [];

// The "Owned only" switch stays hidden until M5 adds Own buttons, since nobody can own
// anything before then (DECISIONS B20). M5 sets this to true, or removes it.
export const OWN_BUTTONS_READY = false;

export function useOwnedIds(): number[] {
  return NO_OWNED;
}

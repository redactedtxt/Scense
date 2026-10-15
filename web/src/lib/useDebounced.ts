import { useEffect, useState } from "react";

// Returns `value` once it has stopped changing for `delayMs`, so typing in a search box
// sends one request per pause instead of one per keystroke.
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

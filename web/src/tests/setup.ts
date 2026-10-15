import "@testing-library/jest-dom/vitest";
import { loadGuestState } from "../lib/guestStore";

// Every test starts as a first-time guest with an empty collection.
beforeEach(() => {
  window.localStorage.clear();
  loadGuestState();
});

// jsdom has no scrolling; React Router's ScrollRestoration calls this on navigation.
window.scrollTo = () => {};

import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { loadGuestState } from "../lib/guestStore";

// findBy* waits up to 1 s by default. Role queries over a whole fragrance page are slow
// when every test file runs in parallel (M9 added a ninth), and the first test in a file
// also pays for loading the page's modules, so give them 5 s before calling it a fail.
configure({ asyncUtilTimeout: 5000 });

// Every test starts as a first-time guest with an empty collection.
beforeEach(() => {
  window.localStorage.clear();
  loadGuestState();
});

// jsdom has no scrolling; React Router's ScrollRestoration calls this on navigation.
window.scrollTo = () => {};

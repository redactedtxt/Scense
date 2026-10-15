import "@testing-library/jest-dom/vitest";

// jsdom has no scrolling; React Router's ScrollRestoration calls this on navigation.
window.scrollTo = () => {};

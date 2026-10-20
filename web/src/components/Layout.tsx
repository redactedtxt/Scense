import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import { useStorageBlocked } from "../lib/collection";
import { useSession, useSignOut } from "../lib/session";
import { Logo } from "./Logo";

// Only pages that exist get a link. Chat and Concierge join this list when they land.
const NAV_ITEMS = [
  { to: "/", label: "Pair" },
  { to: "/browse", label: "Browse" },
  { to: "/me", label: "Collection" },
  { to: "/about", label: "About" },
];

// Shared page gutters: 20px on phones, 4.8vw from 641px up, capped at 1440px wide.
export const PAGE_WIDTH = "mx-auto w-full max-w-[1440px] px-5 sm:px-[4.8vw]";

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <a
        href="#main"
        className="sr-only z-50 bg-gold-deep px-4 py-2 text-on-gold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Header />
      <StorageBanner />
      <main id="main" tabIndex={-1} className={`${PAGE_WIDTH} flex-1 focus:outline-none`}>
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the mobile menu on Escape (links close it when clicked).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="relative z-20 border-b border-line">
      <div
        className={`${PAGE_WIDTH} grid h-header-sm grid-cols-[1fr_auto] items-center sm:h-header md:grid-cols-[1fr_auto_1fr]`}
      >
        <Logo />
        <button
          type="button"
          className="grid w-[38px] cursor-pointer gap-1.5 p-2.5 md:hidden"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="site-nav"
          aria-label="Toggle navigation"
        >
          <span className="h-px w-[18px] bg-gold-icon" />
          <span className="h-px w-[18px] bg-gold-icon" />
        </button>
        <nav
          id="site-nav"
          aria-label="Main"
          className={`${menuOpen ? "flex" : "hidden"} absolute top-header-sm right-0 left-0 flex-col items-start gap-[25px] border-b border-line-strong bg-ink-raised px-5 py-[30px] sm:top-header sm:px-[5vw] md:static md:flex md:flex-row md:items-center md:gap-[clamp(20px,2.4vw,38px)] md:border-0 md:bg-transparent md:p-0`}
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `relative text-[11px] font-medium tracking-[0.11em] uppercase transition-colors duration-[180ms] hover:text-text-bright ${
                  isActive
                    ? "text-text-bright md:after:absolute md:after:right-0 md:after:-bottom-[34px] md:after:left-0 md:after:h-px md:after:bg-gold"
                    : "text-muted"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <div className="md:hidden">
            <AccountControl onNavigate={() => setMenuOpen(false)} />
          </div>
        </nav>
        <div className="hidden justify-self-end md:block">
          <AccountControl />
        </div>
      </div>
    </header>
  );
}

// The header's top-right corner (Figma .sign-in): "Sign in" with a gold underline for a
// guest, or the user's name and "Sign out". Nothing while the session is still loading,
// so a signed-in visitor never sees "Sign in" flash. The link carries ?next= so signing
// in returns to the page the visitor was on.
function AccountControl({ onNavigate }: { onNavigate?: () => void }) {
  const { user, loading } = useSession();
  const signOut = useSignOut();
  const location = useLocation();
  if (loading) return null;
  const linkStyle =
    "border-b border-gold-line py-[5px] text-[11px] font-medium tracking-[0.11em] text-muted uppercase transition-colors duration-[180ms] hover:text-text-bright";
  if (!user) {
    const here = location.pathname + location.search;
    const onAuthPage = location.pathname === "/login" || location.pathname === "/signup";
    const href = here === "/" || onAuthPage ? "/login" : `/login?next=${encodeURIComponent(here)}`;
    return (
      <Link to={href} onClick={onNavigate} className={linkStyle}>
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-4">
      <span className="max-w-[160px] truncate font-display text-[15px] text-soft" title={user.email}>
        {user.displayName}
      </span>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          void signOut();
        }}
        className={`cursor-pointer bg-transparent ${linkStyle}`}
      >
        Sign out
      </button>
    </div>
  );
}

// SPEC section 6: guestStore fell back to memory, so say so on every page.
function StorageBanner() {
  const blocked = useStorageBlocked();
  if (!blocked) return null;
  return (
    <div role="status" className="border-b border-gold-line bg-chip-on">
      <p className={`${PAGE_WIDTH} m-0 py-2.5 text-[11px] leading-snug text-chip-on-text`}>
        Your browser blocked storage, so your collection won't persist.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div
        className={`${PAGE_WIDTH} grid grid-cols-1 gap-[22px] py-[34px] text-[9px] tracking-[0.06em] text-ghost sm:min-h-[130px] sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-0 sm:py-0`}
      >
        <Logo className="opacity-70" />
        <p className="m-0 leading-normal">
          Fragrance data from the Fragrantica community via the Decant dataset. Not affiliated with Fragrantica.
        </p>
        <p className="m-0 uppercase sm:justify-self-end">© 2026 Scense</p>
      </div>
    </footer>
  );
}

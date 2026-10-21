import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ImportOffer } from "../components/ImportOffer";
import { api, ApiError } from "../lib/api";
import { useGuestImportable } from "../lib/collection";
import { safeNext, setSignedIn, useSession } from "../lib/session";

type Mode = "signup" | "login";

const COPY: Record<Mode, { title: string; kicker: string; heading: ReactNode; intro: string; submit: string }> = {
  signup: {
    title: "Create an account",
    kicker: "Create an account",
    heading: (
      <>
        Keep your <em className="font-normal text-gold-pale">collection.</em>
      </>
    ),
    intro: "An account saves your Own and Want lists on our server, so they follow you to any browser.",
    submit: "Create account",
  },
  login: {
    title: "Sign in",
    kicker: "Welcome back",
    heading: (
      <>
        Sign <em className="font-normal text-gold-pale">in.</em>
      </>
    ),
    intro: "Your Own and Want lists are waiting where you left them.",
    submit: "Sign in",
  },
};

// /signup and /login (SPEC section 11). One page, two modes: the forms differ by one
// field and the copy. After success, a visitor with a guest list is offered the import
// (and taste profile) before moving on; everyone else goes straight to ?next= (or home).
export function AuthPage({ mode }: { mode: Mode }) {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const guest = useGuestImportable();
  // Read once at success time: the offer only appears if there was something to import.
  const [offerImport, setOfferImport] = useState(false);
  const copy = COPY[mode];

  // Someone already signed in who opens /login has nothing to do here. `submitted`
  // keeps this from firing for the visitor who just signed in on this page, who may
  // still be looking at the import offer.
  const { user } = useSession();
  const submitted = useRef(false);
  useEffect(() => {
    if (user && !submitted.current) navigate(next, { replace: true });
  }, [user, next, navigate]);

  function onSignedIn() {
    if (guest.bottles > 0 || guest.hasProfile) setOfferImport(true);
    else navigate(next, { replace: true });
  }

  return (
    <>
      <title>{`${copy.title} · Scense`}</title>
      <div className="grid gap-12 pt-[58px] pb-24 sm:pt-[72px] md:grid-cols-[1fr_minmax(0,460px)] md:gap-[6vw]">
        <section>
          <p className="kicker">{copy.kicker}</p>
          <h1 className="mt-4 mb-5 font-display text-[54px] leading-[0.88] font-medium tracking-display sm:text-[clamp(54px,6.2vw,88px)]">
            {copy.heading}
          </h1>
          <p className="m-0 max-w-[485px] font-display text-lg leading-[1.45] text-soft sm:text-xl">{copy.intro}</p>
        </section>
        {offerImport ? (
          <ImportOffer
            bottles={guest.bottles}
            hasProfile={guest.hasProfile}
            onDone={() => navigate(next, { replace: true })}
          />
        ) : (
          <AuthForm mode={mode} next={next} onSubmit={() => (submitted.current = true)} onSignedIn={onSignedIn} />
        )}
      </div>
    </>
  );
}

function AuthForm({
  mode,
  next,
  onSubmit: onStart,
  onSignedIn,
}: {
  mode: Mode;
  next: string;
  onSubmit: () => void;
  onSignedIn: () => void;
}) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const other = mode === "signup" ? "/login" : "/signup";
  const otherHref = next === "/" ? other : `${other}?next=${encodeURIComponent(next)}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    setBusy(true);
    setError(null);
    onStart();
    try {
      const { user } =
        mode === "signup"
          ? await api.signup({ email: field("email"), displayName: field("displayName"), password: field("password") })
          : await api.login({ email: field("email"), password: field("password") });
      setSignedIn(client, user);
      onSignedIn();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="border border-line-strong bg-panel p-6 sm:p-8" aria-label={COPY[mode].title}>
      <div className="grid gap-7">
        <Field label="Email" name="email" type="email" autoComplete="email" maxLength={254} />
        {mode === "signup" && (
          <Field label="Display name" name="displayName" autoComplete="nickname" maxLength={40} />
        )}
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 10 : undefined}
          hint={mode === "signup" ? "At least 10 characters." : undefined}
        />
      </div>
      {error && (
        <p role="alert" className="m-0 mt-6 text-[12px] leading-snug text-chip-on-text">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-8 h-[46px] w-full cursor-pointer bg-gold-deep px-6 text-[10px] font-semibold tracking-label text-on-gold uppercase transition-colors hover:bg-gold disabled:cursor-default disabled:opacity-60"
      >
        {busy ? "One moment…" : COPY[mode].submit}
      </button>
      {mode === "signup" && (
        <p className="m-0 mt-5 text-[11px] leading-snug text-dim">
          There's no email verification or password reset yet, so keep your password somewhere safe.
        </p>
      )}
      <p className="m-0 mt-5 border-t border-line pt-5 text-[11px] text-muted">
        {mode === "signup" ? "Already have an account? " : "New here? "}
        <Link to={otherHref} className="border-b border-gold-line pb-px text-text hover:text-gold-bright">
          {mode === "signup" ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}

// A labelled input in the site's style: small caps label, display-font text on a
// bottom rule that turns gold on focus (like the search boxes).
function Field({
  label,
  hint,
  ...input
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label-caps block text-[9px] font-semibold text-gold-kicker">
        {label}
      </label>
      <input
        id={id}
        required
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...input}
        className="mt-2 h-[46px] w-full min-w-0 border-0 border-b border-line-input bg-transparent font-display text-xl text-text-input outline-0 transition-colors placeholder:text-faint focus:border-gold"
      />
      {hint && (
        <p id={`${id}-hint`} className="m-0 mt-2 text-[11px] text-dim">
          {hint}
        </p>
      )}
    </div>
  );
}

// The API's 400 lists problems as "field: message; field: message". Show just the
// messages, as sentences. Other errors (409 email taken, 401, 429) are already sentences.
function friendlyError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (err.code !== "invalid_request") return err.message;
  return err.message
    .split("; ")
    .map((problem) => problem.replace(/^[\w.]+: /, ""))
    .map((text) => text.charAt(0).toUpperCase() + text.slice(1) + ".")
    .join(" ");
}

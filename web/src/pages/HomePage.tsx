import { Link, Navigate, useLocation } from "react-router";
import { PlaceholderBottle } from "../components/BottleImage";
import { ArrowIcon } from "../components/Icons";
import { PAIR_PATH, PAIRING_PARAMS } from "./pairing/usePairingParams";

type Feature = { to: string; kicker: string; title: string; line: string; action: string };

// The four cards beside the layering card, in the order a first visit tends to go.
const FEATURES: Feature[] = [
  {
    to: "/chat",
    kicker: "Ask in plain words",
    title: "Chat",
    line: "Describe your taste in plain words and get picks.",
    action: "Start a chat",
  },
  {
    to: "/concierge",
    kicker: "What to wear tonight",
    title: "Concierge",
    line: "Describe an outing and it picks from bottles you own.",
    action: "Plan an outing",
  },
  {
    to: "/browse",
    kicker: "The catalogue",
    title: "Browse",
    line: "Search the 1,000 most-voted fragrances.",
    action: "Browse bottles",
  },
  {
    to: "/me",
    kicker: "Own and want",
    title: "Collection",
    line: "Keep the bottles you own and the ones you want.",
    action: "Open collection",
  },
];

// "/": a short welcome and one card per feature, all above the fold. Layering is the
// project's centrepiece (DECISIONS #2), so its card is the biggest and the only gold one.
export function HomePage() {
  const legacy = useLegacyPairingLink();
  if (legacy) return <Navigate to={legacy} replace />;

  return (
    <>
      <title>Scense: fragrance layering, ranked</title>
      <section className="flex flex-col gap-3 pt-6 pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8 sm:pt-12 sm:pb-9">
        <h1 className="m-0 font-display text-[40px] leading-[0.95] font-medium tracking-display sm:text-[clamp(44px,4.6vw,64px)]">
          Welcome to <em className="accent">Scense.</em>
        </h1>
        <Link
          to="/about"
          className="inline-flex w-fit shrink-0 items-center gap-2 border-b border-gold-line pb-1 text-[11px] font-medium tracking-[0.11em] text-muted uppercase hover:text-text-bright"
        >
          How the scoring works <ArrowIcon className="stroke-current" />
        </Link>
      </section>
      <section
        aria-label="What you can do"
        className="grid grid-cols-2 gap-3 pb-16 sm:gap-4 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-2 md:pb-[90px]"
      >
        <LayerCard />
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.to} feature={feature} />
        ))}
      </section>
    </>
  );
}

// Links shared before the home page existed point at "/?f=...". Returns where such a
// link now lives (same query string, on /pair), or null for an ordinary visit. Other
// params, such as a LinkedIn tracking tag, don't count, so they never hide the home page.
function useLegacyPairingLink(): string | null {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  const isPairingLink = PAIRING_PARAMS.some((name) => params.has(name));
  return isPairingLink ? `${PAIR_PATH}${search}${hash}` : null;
}

// The primary card: full width on phones and tablets, the tall left column from 901px.
// The two drawn bottles stand for a base and its partner; they are decoration only.
function LayerCard() {
  return (
    <article className="relative col-span-2 flex flex-col overflow-hidden border border-gold-line bg-panel p-5 sm:p-8 md:col-span-1 md:row-span-2 md:p-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-16 size-[260px] rounded-full border border-[rgba(154,116,61,0.14)] shadow-[0_0_0_40px_rgba(154,116,61,0.03),0_0_0_80px_rgba(154,116,61,0.02)] md:size-[340px]"
      />
      <div aria-hidden="true" className="absolute top-4 right-4 flex h-[74px] items-end sm:top-7 sm:right-8 sm:h-[130px] md:static md:order-2 md:mt-auto md:mb-8 md:h-[190px] md:self-center">
        <div className="relative h-full w-[52px] sm:w-[92px] md:w-[134px]">
          <PlaceholderBottle family="Woody Amber" />
        </div>
        <span className="mb-[30%] font-display text-2xl text-gold-kicker md:text-4xl">+</span>
        <div className="relative h-[82%] w-[46px] sm:w-[80px] md:w-[116px]">
          <PlaceholderBottle family="Soft Floral" />
        </div>
      </div>
      <div className="relative md:order-1">
        <p className="kicker">Start here</p>
        <h2 className="mt-2 mb-2 font-display text-[40px] leading-none font-medium tracking-heading sm:mt-3 sm:text-[52px] md:text-[64px]">
          Layer
        </h2>
        <p className="m-0 max-w-[400px] text-[13px] leading-[1.55] text-soft sm:text-sm md:text-base">
          Pick a bottle you own or a few notes you love, and Scense ranks what to layer with them to enhance the scent
          or soften its edge.
        </p>
      </div>
      <Link
        to={PAIR_PATH}
        className="mt-4 inline-flex h-[46px] w-fit items-center gap-3 bg-gold-deep px-6 text-[10px] font-semibold tracking-label text-on-gold uppercase transition-colors after:absolute after:inset-0 hover:bg-gold sm:mt-7 md:order-3 md:mt-0 md:h-[52px] md:px-8 md:text-[11px]"
      >
        Start layering <ArrowIcon className="stroke-on-gold" />
      </Link>
    </article>
  );
}

// A secondary card. The button's ::after stretches over the whole card, so a click
// anywhere on the card follows the link, while only the button is a tab stop.
function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <article className="group relative flex flex-col border border-line-strong bg-panel-alt p-3.5 transition-colors hover:border-gold-line sm:p-6">
      <p className="kicker hidden sm:block">{feature.kicker}</p>
      <h2 className="m-0 font-display text-[26px] leading-none font-medium tracking-heading sm:mt-2 sm:text-[34px]">
        {feature.title}
      </h2>
      <p className="mt-2 mb-3.5 text-xs leading-[1.5] text-soft sm:mt-3 sm:mb-5 sm:text-[13px]">{feature.line}</p>
      <Link
        to={feature.to}
        className="mt-auto inline-flex h-9 w-fit items-center gap-2 border border-line-control px-3 text-[9px] font-semibold tracking-label whitespace-nowrap text-text uppercase transition-colors after:absolute after:inset-0 group-hover:border-gold-line group-hover:text-gold-bright sm:h-10 sm:px-4 sm:text-[10px]"
      >
        {feature.action} <ArrowIcon className="hidden stroke-current sm:block" />
      </Link>
    </article>
  );
}

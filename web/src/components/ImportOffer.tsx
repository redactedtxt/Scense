import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { importGuestCollection } from "../lib/collection";

// "You have N bottles saved in this browser": shown after signing up or in, and on /me
// while a signed-in visitor still has a guest list or taste profile (SPEC section 6,
// DECISIONS B31). "Not now" leaves both in the browser; nothing is lost, and /me offers
// again.
export function ImportOffer({
  bottles: count,
  hasProfile,
  onDone,
  headingLevel = 2,
}: {
  bottles: number;
  hasProfile: boolean;
  onDone: (imported: boolean) => void;
  headingLevel?: 1 | 2;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const bottles = count === 1 ? "1 bottle" : `${count} bottles`;
  // "your 2 bottles", "your 2 bottles and taste profile", "your taste profile".
  const what = [count > 0 ? bottles : null, hasProfile ? "taste profile" : null].filter(Boolean).join(" and ");
  const single = count + (hasProfile ? 1 : 0) === 1;

  async function runImport() {
    setBusy(true);
    setFailed(false);
    try {
      await importGuestCollection(client);
      onDone(true);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="import-heading" className="border border-line-strong bg-panel p-6 sm:p-8">
      <p className="kicker">Saved in this browser</p>
      <Heading id="import-heading" className="mt-3 mb-3 font-display text-[30px] leading-none font-medium tracking-heading">
        Bring your {what} along?
      </Heading>
      <p className="m-0 mb-6 max-w-[460px] font-display text-lg leading-snug text-soft">
        {count > 0 && <>You marked {bottles} as Own or Want before signing in. </>}
        {hasProfile && <>The chat built you a taste profile in this browser. </>}
        Add {single ? "it" : "them"} to your account so {single ? "it follows" : "they follow"} you to any device.
        {count > 0 && " Bottles already in your account keep their list."}
        {hasProfile && " If your account already has a taste profile, it keeps its own."}
      </p>
      {failed && (
        <p role="alert" className="m-0 mb-4 text-[12px] text-chip-on-text">
          The import didn't go through. Everything is still in this browser; try again.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={runImport}
          disabled={busy}
          className="h-[46px] cursor-pointer bg-gold-deep px-6 text-[10px] font-semibold tracking-label text-on-gold uppercase transition-colors hover:bg-gold disabled:cursor-default disabled:opacity-60"
        >
          {busy ? "Adding…" : `Add ${what}`}
        </button>
        <button
          type="button"
          onClick={() => onDone(false)}
          disabled={busy}
          className="h-[46px] cursor-pointer border border-line-control px-6 text-[10px] font-semibold tracking-label text-muted uppercase transition-colors hover:border-gold-deep hover:text-text-bright"
        >
          Not now
        </button>
      </div>
    </section>
  );
}

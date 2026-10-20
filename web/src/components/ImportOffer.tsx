import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { importGuestCollection } from "../lib/collection";

// "You have N bottles saved in this browser": shown after signing up or in, and on /me
// while a signed-in visitor still has a guest list (SPEC section 6, DECISIONS B31).
// "Not now" leaves the bottles in the browser; nothing is lost, and /me offers again.
export function ImportOffer({
  count,
  onDone,
  headingLevel = 2,
}: {
  count: number;
  onDone: (imported: boolean) => void;
  headingLevel?: 1 | 2;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const bottles = count === 1 ? "1 bottle" : `${count} bottles`;

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
        Bring your {bottles} along?
      </Heading>
      <p className="m-0 mb-6 max-w-[460px] font-display text-lg leading-snug text-soft">
        You marked {bottles} as Own or Want before signing in. Add them to your account so they follow you to any
        device. Bottles already in your account keep their list.
      </p>
      {failed && (
        <p role="alert" className="m-0 mb-4 text-[12px] text-chip-on-text">
          The import didn't go through. Your bottles are still in this browser; try again.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={runImport}
          disabled={busy}
          className="h-[46px] cursor-pointer bg-gold-deep px-6 text-[10px] font-semibold tracking-label text-on-gold uppercase transition-colors hover:bg-gold disabled:cursor-default disabled:opacity-60"
        >
          {busy ? "Adding…" : `Add ${bottles}`}
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

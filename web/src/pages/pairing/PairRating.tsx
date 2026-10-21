import { useState } from "react";
import { SignInPrompt, StarInput } from "../../components/Stars";
import { ApiError, type Goal } from "../../lib/api";
import { usePairRatings, useRatePair } from "../../lib/pairRatings";
import { useSession } from "../../lib/session";

// "How well did this pair work for you?" on a result card (M8). The rating is for this
// base, this partner, and the goal on screen; it is stored and changes no score
// (decision 11). Guests see the stars disabled and a link to sign in.
//
// Both rows always take their space (the second may be empty), so the card is the same
// height for a guest, a user, and while the session loads: nothing moves.

type Props = { baseId: number | undefined; baseName: string; partnerId: number; partnerName: string; goal: Goal };

export function PairRating({ baseId, baseName, partnerId, partnerName, goal }: Props) {
  const { user, loading } = useSession();
  const ratings = usePairRatings(baseId, goal);
  const rate = useRatePair();
  const [message, setMessage] = useState("");
  const value = ratings.data?.[partnerId] ?? null;
  const canRate = user !== null && baseId !== undefined && ratings.isSuccess;

  async function onChange(stars: number) {
    setMessage("");
    try {
      await rate(baseId!, partnerId, goal, stars);
      setMessage("Saved");
    } catch (err) {
      setMessage(err instanceof ApiError && err.status === 429 ? err.message : "Not saved. Try again.");
    }
  }

  const verb = goal === "enhance" ? "enhanced" : "softened";
  return (
    <div className="mt-3 flex items-end justify-between gap-3">
      <div>
        <p aria-hidden="true" className="label-caps m-0 mb-0.5 text-[8px] text-dim">
          Your rating
        </p>
        {/* -ml-1 lines the first star up with the label; each star has 4px of padding
            so the tap target is bigger than the icon. */}
        <div className="-ml-1">
          <StarInput
            legend={`Rate how well ${partnerName} ${verb} ${baseName} for you`}
            legendHidden
            size="small"
            value={value}
            onChange={onChange}
            disabled={!canRate}
          />
        </div>
      </div>
      {!loading && !user ? (
        <p className="m-0 mb-1.5 text-right">
          <SignInPrompt label="Sign in to rate" compact />
        </p>
      ) : (
        <p role="status" className="m-0 mb-1.5 text-right text-[10px] text-dim">
          {message}
        </p>
      )}
    </div>
  );
}

import { useState } from "react";
import { familyColor } from "../lib/labels";

type Props = {
  src: string | null;
  family: string;
  // Empty alt when the fragrance name is already next to the picture (decorative).
  alt?: string;
  // Sizing for the frame. The frame always has a fixed size or aspect ratio, so the
  // page never moves when the photo (or the placeholder) arrives.
  className?: string;
  lazy?: boolean;
};

// A fragrance photo, hotlinked from Fragrantica's image server (DECISIONS B19). If the
// photo is missing or the server refuses it, a drawn bottle tinted by the fragrance's
// dominant family takes its place.
export function BottleImage({ src, family, alt = "", className = "", lazy = false }: Props) {
  // Remember which URL failed, so a new src (another fragrance) gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = src !== null && failedSrc !== src;

  return (
    // With a photo, the frame turns paper-toned and the photo multiplies onto it, so the
    // photos' white backgrounds become a muted tone instead of glaring on the dark page.
    <div className={`relative overflow-hidden ${showPhoto ? "bg-paper" : "bg-frame"} ${className}`}>
      {showPhoto ? (
        <img
          src={src}
          alt={alt}
          loading={lazy ? "lazy" : "eager"}
          decoding="async"
          // Some image hosts refuse requests that name another site as the referrer.
          referrerPolicy="no-referrer"
          width={375}
          height={500}
          onError={() => setFailedSrc(src)}
          className="bottle-photo absolute inset-0 size-full object-contain p-[6%] mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.04]"
        />
      ) : (
        <PlaceholderBottle family={family} label={alt} />
      )}
    </div>
  );
}

// A simple bottle drawing: cap, neck, shoulders, and a label band, in the family's tint.
export function PlaceholderBottle({ family, label }: { family: string; label?: string }) {
  const tint = familyColor(family);
  return (
    <svg
      viewBox="0 0 60 80"
      className="absolute inset-0 m-auto h-[72%] w-auto"
      style={{ color: tint }}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-testid="placeholder-bottle"
    >
      <rect x="24" y="6" width="12" height="10" rx="1.5" fill="currentColor" opacity="0.85" />
      <rect x="26.5" y="16" width="7" height="6" fill="currentColor" opacity="0.5" />
      <path
        d="M14 30c0-5 4-8 9-8h14c5 0 9 3 9 8v38c0 3-2 5-5 5H19c-3 0-5-2-5-5z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeOpacity="0.7"
        strokeWidth="1"
      />
      <rect x="19" y="44" width="22" height="13" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="0.8" />
      <path d="M18 31c1-3 3-4 6-4" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

// Line icons from the Figma export. Decorative: the control around each icon carries the label.
export function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`w-[19px] fill-none stroke-gold-icon stroke-[1.4] ${className}`}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function ArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`w-[15px] fill-none stroke-[1.4] ${className}`}>
      <path d="M5 12h13M14 7l5 5-5 5" />
    </svg>
  );
}

// A five-point star. Filled or outlined by the caller's fill and stroke classes.
export function StarIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`stroke-[1.4] ${className}`}>
      <path
        strokeLinejoin="round"
        d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"
      />
    </svg>
  );
}

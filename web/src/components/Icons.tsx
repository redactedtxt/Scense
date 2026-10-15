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

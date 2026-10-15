import { Link } from "react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="Scense home"
      className={`inline-flex w-fit items-center gap-[9px] font-display text-[21px] font-medium tracking-[0.02em] sm:gap-3 sm:text-2xl ${className}`}
    >
      <span
        aria-hidden="true"
        className="grid size-[27px] place-items-center rounded-full border border-gold-deep text-[15px] text-gold-bright italic sm:size-[30px] sm:text-[17px]"
      >
        S
      </span>
      <span>Scense</span>
    </Link>
  );
}

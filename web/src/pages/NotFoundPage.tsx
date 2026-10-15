import { Link } from "react-router";

export function NotFoundPage({ message = "There is no page at this address." }: { message?: string }) {
  return (
    <section className="py-24">
      <title>Not found · Scense</title>
      <p className="kicker">Not found</p>
      <h1 className="mt-4 mb-5 font-display text-[54px] leading-[0.88] font-medium tracking-display">
        Nothing <em className="font-normal text-gold-pale">here.</em>
      </h1>
      <p className="m-0 max-w-[485px] font-display text-lg text-soft">{message}</p>
      <p className="mt-8 flex gap-6 text-[11px] font-medium tracking-[0.11em] uppercase">
        <Link to="/" className="border-b border-gold-line pb-1 text-muted hover:text-text-bright">
          Pair a fragrance
        </Link>
        <Link to="/browse" className="border-b border-gold-line pb-1 text-muted hover:text-text-bright">
          Browse the catalogue
        </Link>
      </p>
    </section>
  );
}

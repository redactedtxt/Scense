// M0 hello page. The real pairing page arrives in M4.
export function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-5 md:px-[4.8vw]">
      <header className="flex h-[72px] items-center border-b border-line md:h-[84px]">
        <span className="font-display text-[21px] font-medium tracking-wide md:text-2xl">
          Scense
        </span>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
          Fragrance layering
        </p>
        <h1 className="mt-4 font-display text-[54px] leading-[0.88] font-medium tracking-[-0.045em] md:text-[88px]">
          Hello, <em className="font-normal text-gold-bright">Scense</em>
        </h1>
        <p className="mt-5 max-w-[485px] font-display text-lg text-muted md:text-xl">
          The scaffold is running. Pairing, catalogue, and the rest come next.
        </p>
      </main>
    </div>
  );
}

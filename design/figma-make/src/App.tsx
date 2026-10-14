import { useMemo, useState } from "react";

type Match = {
  rank: number;
  name: string;
  brand: string;
  score: number;
  family: string;
  owned?: boolean;
  image: string;
  position: string;
};

type NoteMatch = {
  rank: number;
  name: string;
  family: string;
  score: number;
};

const matches: Match[] = [
  {
    rank: 1,
    name: "L'Eau d'Issey Pour Homme",
    brand: "ISSEY MIYAKE",
    score: 96,
    family: "Aromatic Fougère",
    owned: true,
    image:
      "https://images.unsplash.com/photo-1627823569857-4d8581dc62b2?auto=format&fit=crop&w=420&q=85",
    position: "50% 48%",
  },
  {
    rank: 2,
    name: "Terre d'Hermès Eau Givrée",
    brand: "HERMÈS",
    score: 93,
    family: "Citrus",
    image:
      "https://images.unsplash.com/photo-1617661338085-d1ec6a89a6d8?auto=format&fit=crop&w=420&q=85",
    position: "54% 50%",
  },
  {
    rank: 3,
    name: "Molecule 01",
    brand: "ESCENTRIC MOLECULES",
    score: 89,
    family: "Woods",
    owned: true,
    image:
      "https://images.unsplash.com/photo-1608721279136-cd41b752fa41?auto=format&fit=crop&w=420&q=85",
    position: "50% 55%",
  },
  {
    rank: 4,
    name: "Neroli Portofino",
    brand: "TOM FORD",
    score: 87,
    family: "Citrus",
    image:
      "https://images.unsplash.com/photo-1640975972263-1f73398e943b?auto=format&fit=crop&w=420&q=85",
    position: "55% 52%",
  },
  {
    rank: 5,
    name: "Grey Vetiver",
    brand: "TOM FORD",
    score: 84,
    family: "Woods",
    image:
      "https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?auto=format&fit=crop&w=420&q=85",
    position: "50% 45%",
  },
];

const noteMatches: NoteMatch[] = [
  { rank: 1, name: "Bergamot", family: "Citrus", score: 97 },
  { rank: 2, name: "Lavender", family: "Aromatic Fougère", score: 94 },
  { rank: 3, name: "Neroli", family: "Floral", score: 91 },
  { rank: 4, name: "Cedar", family: "Woods", score: 88 },
  { rank: 5, name: "Vetiver", family: "Dry Woods", score: 85 },
];

const noteOptions = [
  "Bergamot",
  "Rose",
  "Oud",
  "Vanilla",
  "Cedar",
  "Musk",
  "Iris",
  "Amber",
];

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 12h13M14 7l5 5-5 5" />
    </svg>
  );
}

function MatchCard({
  match,
  effect,
}: {
  match: Match;
  effect: "enhance" | "soften";
}) {
  return (
    <article className="match-card">
      <div className="rank" aria-label={`Rank ${match.rank}`}>
        <span>NO.</span>
        {String(match.rank).padStart(2, "0")}
      </div>
      <div className="bottle-frame">
        <img
          src={match.image}
          alt=""
          style={{ objectPosition: match.position }}
        />
      </div>
      <div className="match-info">
        <p className="eyebrow">{match.brand}</p>
        <h3>{match.name}</h3>
        <div className="tags">
          <span>{match.family}</span>
          {match.owned && <span className="owned">Owned</span>}
        </div>
      </div>
      <div className="score">
        <div className="score-top">
          <span>Layering score</span>
          <strong>{match.score}</strong>
        </div>
        <div className="score-track">
          <span style={{ width: `${match.score}%` }} />
        </div>
        <p>{effect === "enhance" ? "Enhances" : "Softens"}</p>
      </div>
      <button className="icon-button" aria-label={`View ${match.name}`}>
        <ArrowIcon />
      </button>
    </article>
  );
}

function NoteMatchRow({
  note,
  effect,
}: {
  note: NoteMatch;
  effect: "enhance" | "soften";
}) {
  return (
    <article className="note-match-row">
      <div className="rank" aria-label={`Rank ${note.rank}`}>
        <span>NO.</span>
        {String(note.rank).padStart(2, "0")}
      </div>
      <div className="note-match-info">
        <p className="eyebrow">LAYERING NOTE</p>
        <h3>{note.name}</h3>
        <span className="family-tag">{note.family}</span>
      </div>
      <div className="score">
        <div className="score-top">
          <span>Layering score</span>
          <strong>{note.score}</strong>
        </div>
        <div className="score-track">
          <span style={{ width: `${note.score}%` }} />
        </div>
        <p>{effect === "enhance" ? "Enhances" : "Softens"}</p>
      </div>
    </article>
  );
}

export default function App() {
  const [mode, setMode] = useState<"fragrance" | "notes">("fragrance");
  const [effect, setEffect] = useState<"enhance" | "soften">("soften");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([
    "Bergamot",
    "Oud",
  ]);
  const [rankSearch, setRankSearch] = useState("");

  const visibleMatches = useMemo(
    () => (ownedOnly ? matches.filter((match) => match.owned) : matches),
    [ownedOnly],
  );

  function toggleNote(note: string) {
    setSelectedNotes((current) =>
      current.includes(note)
        ? current.filter((item) => item !== note)
        : [...current, note],
    );
  }

  return (
    <div className="app-shell">
      <header>
        <a className="logo" href="#" aria-label="Scense home">
          <span className="logo-mark">S</span>
          <span>Scense</span>
        </a>
        <button
          className="menu-button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-label="Toggle navigation"
        >
          <span />
          <span />
        </button>
        <nav className={menuOpen ? "open" : ""}>
          {["Pair", "Browse", "Chat", "Concierge", "Collection", "About"].map(
            (item) => (
              <a
                key={item}
                href={`#${item.toLowerCase()}`}
                className={item === "Pair" ? "active" : ""}
                onClick={() => setMenuOpen(false)}
              >
                {item}
              </a>
            ),
          )}
        </nav>
        <button className="sign-in">Sign in</button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="kicker">The art of fragrance layering</p>
            <h1>
              Find your perfect
              <br />
              <em>second scent.</em>
            </h1>
            <p className="intro">
              Choose a fragrance you love. We&apos;ll find the notes that make
              it feel entirely your own.
            </p>
          </div>
          <div className="edition">
            <span>PAIRING JOURNAL</span>
            <strong>01</strong>
            <span>DISCOVER YOUR ACCORD</span>
          </div>
        </section>

        <section className="pairing-desk" id="pair">
          <div className="desk-head">
            <div>
              <p className="step-label">01 — Begin with</p>
              <div className="text-tabs" role="tablist">
                <button
                  className={mode === "fragrance" ? "selected" : ""}
                  onClick={() => setMode("fragrance")}
                  role="tab"
                  aria-selected={mode === "fragrance"}
                >
                  Fragrance
                </button>
                <button
                  className={mode === "notes" ? "selected" : ""}
                  onClick={() => setMode("notes")}
                  role="tab"
                  aria-selected={mode === "notes"}
                >
                  Notes
                </button>
              </div>
            </div>
            <div className="effect-control">
              <p className="step-label">02 — I want to</p>
              <div className="segmented">
                <button
                  className={effect === "enhance" ? "selected" : ""}
                  onClick={() => setEffect("enhance")}
                  aria-pressed={effect === "enhance"}
                >
                  Enhance
                </button>
                <button
                  className={effect === "soften" ? "selected" : ""}
                  onClick={() => setEffect("soften")}
                  aria-pressed={effect === "soften"}
                >
                  Soften
                </button>
              </div>
            </div>
          </div>

          {mode === "fragrance" ? (
            <div className="selected-fragrance">
              <div className="search-line">
                <SearchIcon />
                <input
                  aria-label="Search fragrances"
                  defaultValue="Club de Nuit Intense Man"
                />
                <button aria-label="Clear search">×</button>
              </div>
              <div className="selection-meta">
                <div className="mini-bottle">
                  <img
                    src="https://images.unsplash.com/photo-1705936118918-870095881e61?auto=format&fit=crop&w=200&q=80"
                    alt=""
                  />
                </div>
                <div>
                  <p className="eyebrow">ARMAF · 2015</p>
                  <strong>Club de Nuit Intense Man</strong>
                  <p>Woody Amber · Eau de toilette</p>
                </div>
                <span className="selected-mark">Selected</span>
              </div>
            </div>
          ) : (
            <div className="note-picker">
              <div className="search-line">
                <SearchIcon />
                <input aria-label="Search notes" placeholder="Search a note…" />
              </div>
              <div className="note-chips">
                {noteOptions.map((note) => (
                  <button
                    key={note}
                    className={selectedNotes.includes(note) ? "selected" : ""}
                    onClick={() => toggleNote(note)}
                  >
                    {note}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="results">
          <div className="results-head">
            <div>
              <p className="kicker">
                {effect === "soften" ? "Soften the edge" : "Amplify it"}
              </p>
              <h2>Your layering accords</h2>
              <p className="results-summary">
                299 fragrances ranked to{" "}
                {effect === "soften" ? "tone down" : "strengthen"} Club de Nuit
                Intense Man.
              </p>
            </div>
            {mode === "fragrance" && (
              <label className="switch-row">
                <span>Owned only</span>
                <input
                  type="checkbox"
                  checked={ownedOnly}
                  onChange={(event) => setOwnedOnly(event.target.checked)}
                />
                <i />
              </label>
            )}
          </div>

          {mode === "fragrance" ? (
            <div className="match-list">
              {visibleMatches.map((match) => (
                <MatchCard key={match.rank} match={match} effect={effect} />
              ))}
            </div>
          ) : (
            <div className="note-match-list">
              {noteMatches.map((note) => (
                <NoteMatchRow key={note.rank} note={note} effect={effect} />
              ))}
            </div>
          )}

          <div className="rank-finder">
            <div>
              <p className="kicker">Already have something in mind?</p>
              <h2>Find my bottle&apos;s rank</h2>
            </div>
            <div className="rank-search">
              <SearchIcon />
              <input
                value={rankSearch}
                onChange={(event) => setRankSearch(event.target.value)}
                placeholder="Search any fragrance"
                aria-label="Find my bottle's rank"
              />
            </div>
            <div className={rankSearch ? "rank-result visible" : "rank-result"}>
              <span>Les Sables Roses</span>
              <strong>#38 <small>of 299</small></strong>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <a className="logo footer-logo" href="#">
          <span className="logo-mark">S</span>
          <span>Scense</span>
        </a>
        <p>
          Fragrance data from the Fragrantica community via the Decant dataset.
          Not affiliated with Fragrantica.
        </p>
        <p>© 2026 Scense</p>
      </footer>
    </div>
  );
}

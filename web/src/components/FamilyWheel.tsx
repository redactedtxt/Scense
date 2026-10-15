import { familyColor, percent } from "../lib/labels";

const FAMILIES_ON_RING = 14;

type Slice = { name: string; share: number };

// The fragrance wheel as a polar chart: one wedge per family, in ring order clockwise
// from the top, each wedge's length proportional to that family's share. The largest
// share reaches the outer edge, so even a spread-out profile stays readable.
export function FamilyWheel({ slices, size = 220 }: { slices: Slice[]; size?: number }) {
  const centre = size / 2;
  const inner = size * 0.12;
  const outer = size * 0.48;
  const biggest = Math.max(...slices.map((s) => s.share), 0.0001);
  const top = [...slices].sort((a, b) => b.share - a.share).filter((s) => s.share >= 0.01);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Family profile: ${top.map((s) => `${s.name} ${percent(s.share)}`).join(", ")}`}
      className="max-w-full"
    >
      {[0.33, 0.66, 1].map((step) => (
        <circle
          key={step}
          cx={centre}
          cy={centre}
          r={inner + (outer - inner) * step}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="1"
        />
      ))}
      {slices.map((slice, index) => {
        const reach = inner + (outer - inner) * (slice.share / biggest);
        return (
          <path
            key={slice.name}
            d={wedgePath(centre, inner, Math.max(reach, inner + 1), index)}
            fill={familyColor(slice.name)}
            fillOpacity={slice.share > 0 ? 0.85 : 0}
            stroke="var(--color-ink)"
            strokeWidth="1"
          />
        );
      })}
    </svg>
  );
}

// One ring segment between two radii. Position 0 is centred at 12 o'clock.
function wedgePath(c: number, r1: number, r2: number, index: number): string {
  const step = (2 * Math.PI) / FAMILIES_ON_RING;
  const start = index * step - step / 2 - Math.PI / 2;
  const end = start + step;
  const point = (r: number, a: number) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  return `M ${point(r1, start)} L ${point(r2, start)} A ${r2} ${r2} 0 0 1 ${point(r2, end)} L ${point(r1, end)} A ${r1} ${r1} 0 0 0 ${point(r1, start)} Z`;
}

// Position on the ring for a label or node (used by the About page diagram).
export function ringPoint(c: number, r: number, index: number) {
  const angle = (index * 2 * Math.PI) / FAMILIES_ON_RING - Math.PI / 2;
  return { x: c + r * Math.cos(angle), y: c + r * Math.sin(angle) };
}

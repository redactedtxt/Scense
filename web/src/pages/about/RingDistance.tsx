import { useState, type ReactNode } from "react";
import { ringPoint } from "../../components/FamilyWheel";
import { Segmented } from "../../components/ui";
import type { Family, Goal } from "../../lib/api";
import { familyColor } from "../../lib/labels";

const RING_SIZE = 14;

// Ring distance: steps around the shorter way, 0 to 7.
export function ringDistance(i: number, j: number): number {
  const gap = Math.abs(i - j);
  return Math.min(gap, RING_SIZE - gap);
}

// How brightly the diagram draws a family, 0 to 1, for the goal it would serve. These
// shapes are only for the picture: the real affinity numbers live in scoring.yaml, and
// the page never shows them, so the two can't drift apart (DECISIONS B20).
function brightness(goal: Goal, distance: number): number {
  return goal === "enhance" ? Math.max(0, 1 - distance / 4) : distance / 7;
}

// Step 02 of the About page: the formula, what i and j are, a worked example, and the
// ring itself. Picking a family (on the ring, or in the list on phones) drives all three.
export function RingDistance({ families }: { families: Family[] }) {
  const [selected, setSelected] = useState(0);
  const [pointed, setPointed] = useState<number | null>(null);
  const [goal, setGoal] = useState<Goal>("enhance");
  // The example pairs the selected family with the one the visitor last pointed at. Before
  // that it uses the family ten steps clockwise, where going the other way is shorter, so
  // the example shows why the formula takes the minimum.
  const partner = pointed !== null && pointed !== selected ? pointed : (selected + 10) % RING_SIZE;
  const view = { families, selected, goal, onSelect: setSelected, onPoint: setPointed };

  return (
    <>
      <p>
        Distance counts the steps between two families the short way round the wheel, from 0 (the same family) to 7
        (directly opposite):
      </p>
      <Formula />
      <p>
        Here <InlineVar name="i" /> and <InlineVar name="j" /> are the two families&apos; positions on the ring, numbered
        0 to 13 clockwise from Soft Amber at the top. <InlineMath>{absGap()}</InlineMath> counts the steps one way round
        and{" "}
        <InlineMath>
          <mn>14</mn>
          <mo>−</mo>
          {absGap()}
        </InlineMath>{" "}
        the other way; the distance is the shorter of the two.
      </p>
      <WorkedExample from={families[selected]} to={families[partner]} />
      <div className="mt-8 mb-6 max-w-[280px]">
        <Segmented
          label="Shade by goal"
          options={[
            { value: "enhance", label: "Enhance" },
            { value: "soften", label: "Soften" },
          ]}
          value={goal}
          onChange={setGoal}
        />
      </div>
      <p className="text-dim">Pick a family to measure from it.</p>
      <RingSvg {...view} />
      <RankedDistances {...view} />
      <Legend goal={goal} selectedName={families[selected]?.name ?? ""} />
    </>
  );
}

// |i − j| in MathML.
function absGap() {
  return (
    <mrow>
      <mo stretchy="false">|</mo>
      <mi>i</mi>
      <mo>−</mo>
      <mi>j</mi>
      <mo stretchy="false">|</mo>
    </mrow>
  );
}

// d(i, j) = min(|i − j|, 14 − |i − j|), typeset with MathML, which every current browser
// draws natively, so the page needs no maths library.
function Formula() {
  const iMinusJ = absGap();
  return (
    <div className="my-6 overflow-x-auto border border-line-strong bg-panel-alt px-4 py-5 text-center text-text-bright sm:px-5 sm:py-6">
      <math display="block" className="font-math text-[19px] sm:text-[26px] md:text-[30px]">
        <mrow>
          <mi>d</mi><mo>(</mo><mi>i</mi><mo>,</mo><mi>j</mi><mo>)</mo>
          <mo>=</mo>
          <mi>min</mi><mo>(</mo>{iMinusJ}<mo>,</mo><mn>14</mn><mo>−</mo>{iMinusJ}<mo>)</mo>
        </mrow>
      </math>
    </div>
  );
}

function InlineVar({ name }: { name: string }) {
  return (
    <InlineMath>
      <mi>{name}</mi>
    </InlineMath>
  );
}

function InlineMath({ children }: { children: ReactNode }) {
  return <math className="font-math text-[1.15em] whitespace-nowrap text-text">{children}</math>;
}

// "Soft Amber (0) to Fruity (10): |0 − 10| = 10 steps one way, 14 − 10 = 4 the other,
// so 4 steps the short way round." Announced politely when the pair changes.
function WorkedExample({ from, to }: { from?: Family; to?: Family }) {
  if (!from || !to) return null;
  const gap = Math.abs(from.id - to.id);
  const d = ringDistance(from.id, to.id);
  return (
    <div className="border-l-2 border-gold-deep bg-panel-alt px-5 py-4" aria-live="polite">
      <p className="kicker mb-2!">Worked example</p>
      <p className="m-0! text-text">
        <strong className="font-semibold">{from.name}</strong> ({from.id}) to{" "}
        <strong className="font-semibold">{to.name}</strong> ({to.id}): |{from.id} − {to.id}| = {gap} {gap === 1 ? "step" : "steps"} one way,
        14 − {gap} = {RING_SIZE - gap} the other, so{" "}
        <strong className="font-semibold text-gold-bright">
          {d} {d === 1 ? "step" : "steps"} the short way round
        </strong>
        .
      </p>
    </div>
  );
}

type ViewProps = {
  families: Family[];
  selected: number;
  goal: Goal;
  onSelect: (id: number) => void;
  onPoint: (id: number | null) => void;
};

// Layout of the ring, in viewBox units. Labels sit just outside their own node.
const VIEW_W = 640;
const VIEW_H = 520;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const RING_R = 200;
const LABEL_R = RING_R + 34;

// From 641px: the ring, with a line from the selected family to every other one.
function RingSvg(props: ViewProps) {
  const { families, selected, goal } = props;
  const from = ringXY(selected, RING_R);
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="hidden w-full max-w-[640px] sm:block"
      role="group"
      aria-label={`Fragrance wheel, measuring from ${families[selected]?.name}`}
      onMouseLeave={() => props.onPoint(null)}
    >
      <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="var(--color-line-strong)" />
      {families.map((family) => {
        if (family.id === selected) return null;
        const to = ringXY(family.id, RING_R);
        const strength = brightness(goal, ringDistance(selected, family.id));
        return (
          <line
            key={family.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="var(--color-gold)"
            strokeOpacity={0.1 + 0.6 * strength}
            strokeWidth={1 + 1.5 * strength}
          />
        );
      })}
      {families.map((family) => (
        <RingNode key={family.id} family={family} {...props} />
      ))}
      <DistanceDigits families={families} selected={selected} />
    </svg>
  );
}

// The distance printed on each node. A layer of its own, outside the buttons: each button's
// label already says the distance, and a digit inside it would make the visible text
// ("4 Fruity") disagree with the label ("Fruity, position 10, ..."), which screen-reader
// voice control relies on. A dark outline keeps each digit readable on bright and faded nodes.
function DistanceDigits({ families, selected }: { families: Family[]; selected: number }) {
  return (
    <g aria-hidden="true" className="pointer-events-none">
      {families.map((family) => {
        const node = ringXY(family.id, RING_R);
        return (
          <text key={family.id} x={node.x} y={node.y + 6} textAnchor="middle" paintOrder="stroke" stroke="var(--color-ink)" strokeWidth={3} className="fill-text-bright font-display text-[18px]">
            {ringDistance(selected, family.id)}
          </text>
        );
      })}
    </g>
  );
}

function ringXY(id: number, radius: number) {
  const { x, y } = ringPoint(0, radius, id);
  return { x: CX + x, y: CY + y };
}

// Which side of its node a label goes on: right of nodes on the right half, left of nodes
// on the left half, and centred above or below the nodes at the top and bottom.
function labelAnchor(id: number): "start" | "middle" | "end" {
  const { x } = ringPoint(0, 1, id);
  if (x > 0.2) return "start";
  if (x < -0.2) return "end";
  return "middle";
}

function RingNode({ family, families, selected, goal, onSelect, onPoint }: ViewProps & { family: Family }) {
  const isSelected = family.id === selected;
  const distance = ringDistance(selected, family.id);
  const node = ringXY(family.id, RING_R);
  const label = ringXY(family.id, LABEL_R);
  const radius = isSelected ? 24 : 19;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${family.name}, position ${family.id}, ${distance} ${distance === 1 ? "step" : "steps"} from ${families[selected]?.name}`}
      onClick={() => onSelect(family.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(family.id);
        }
      }}
      onMouseEnter={() => onPoint(family.id)}
      onFocus={() => onPoint(family.id)}
      className="group cursor-pointer outline-none"
    >
      {/* The focus ring: a gold circle around the node, shown only for keyboard focus. */}
      <circle cx={node.x} cy={node.y} r={radius + 6} fill="none" stroke="var(--color-gold)" strokeWidth={2} className="opacity-0 group-focus-visible:opacity-100" />
      <circle
        cx={node.x}
        cy={node.y}
        r={radius}
        fill={familyColor(family.name)}
        fillOpacity={isSelected ? 1 : 0.15 + 0.75 * brightness(goal, distance)}
        stroke={isSelected ? "var(--color-gold-bright)" : "var(--color-ink)"}
        strokeWidth={isSelected ? 2 : 1}
      />
      <text
        x={label.x}
        y={label.y + 4}
        textAnchor={labelAnchor(family.id)}
        className={`text-[13px] ${isSelected ? "fill-text-bright font-semibold" : "fill-muted group-hover:fill-text-bright"}`}
      >
        {family.name}
      </text>
    </g>
  );
}

// Below 641px the ring's labels would be too small to read, so phones get the same
// information as a list: every family ranked by how well it serves the goal.
function RankedDistances({ families, selected, goal, onSelect, onPoint }: ViewProps) {
  const others = families
    .filter((f) => f.id !== selected)
    .map((f) => ({ family: f, distance: ringDistance(selected, f.id) }))
    .sort((a, b) => (goal === "enhance" ? a.distance - b.distance : b.distance - a.distance) || a.family.id - b.family.id);
  return (
    <div className="sm:hidden">
      <p className="mb-3! text-text">
        From <strong className="font-semibold">{families[selected]?.name}</strong> ({selected}),{" "}
        {goal === "enhance" ? "closest first" : "farthest first"}:
      </p>
      <ol aria-label={`Distances from ${families[selected]?.name}`} className="m-0 grid list-none gap-1.5 p-0">
        {others.map(({ family, distance }) => (
          <li key={family.id}>
            <button
              type="button"
              onClick={() => onSelect(family.id)}
              onFocus={() => onPoint(family.id)}
              className="grid min-h-11 w-full cursor-pointer grid-cols-[14px_1fr_auto] items-center gap-3 border border-line px-3 text-left hover:border-line-control"
            >
              <span aria-hidden="true" className="size-3.5 rounded-full" style={{ background: familyColor(family.name), opacity: 0.25 + 0.75 * brightness(goal, distance) }} />
              <span className="text-text">
                {family.name} <span className="text-dim">({family.id})</span>
              </span>
              <span className="font-display text-lg text-gold-bright">
                {distance} <span className="font-sans text-[10px] text-dim">{distance === 1 ? "step" : "steps"}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

// What the picture's brightness, colour, and numbers mean. The brightness line follows the
// goal toggle, since the two goals read the same distance in opposite directions.
function Legend({ goal, selectedName }: { goal: Goal; selectedName: string }) {
  const ramp = goal === "enhance" ? "from-gold to-gold/10" : "from-gold/10 to-gold";
  return (
    <ul className="mt-6 grid list-none gap-3 border-t border-line pt-5 pl-0 text-[13px]" aria-label="Legend">
      <li className="grid grid-cols-[44px_1fr] items-center gap-3">
        <span aria-hidden="true" className={`h-2 bg-linear-to-r ${ramp}`} />
        <span>
          <strong className="font-semibold text-text">Brightness</strong>{" "}
          {goal === "enhance"
            ? "Brighter nodes and lines are closer on the ring, so they enhance more. Faded ones are too far away to enhance."
            : "Brighter nodes and lines are farther round the ring, so they soften more. Faded ones are close by and barely soften."}
        </span>
      </li>
      <li className="grid grid-cols-[44px_1fr] items-center gap-3">
        <span aria-hidden="true" className="flex gap-1">
          {["Amber", "Water", "Floral"].map((name) => (
            <span key={name} className="size-2.5 rounded-full" style={{ background: familyColor(name) }} />
          ))}
        </span>
        <span>
          <strong className="font-semibold text-text">Colour</strong> Each family&apos;s own tint on the wheel. It tells
          the families apart; it isn&apos;t a score.
        </span>
      </li>
      <li className="grid grid-cols-[44px_1fr] items-center gap-3">
        <span aria-hidden="true" className="text-center font-display text-lg text-text-bright">3</span>
        <span>
          <strong className="font-semibold text-text">Number</strong> Steps from {selectedName}, the short way round.
        </span>
      </li>
    </ul>
  );
}

/**
 * The Slope mark: one descending path split into three slices, the fill
 * ball leaving at the end — the product in one glyph.
 *
 * Plotter-pen rules (design system): uniform stroke, rounded segment ends,
 * no glow, no shadow — ink on graph paper, not light. The geometry is
 * machine-generated: one easing cubic cut into three equal arc lengths,
 * gaps calibrated so the slices stay readable down to the ~24 px header
 * size (stroke ≈ gap ≈ 2 px there, growing proportionally above it).
 * Colors ride the palette variables, so the mark follows the theme.
 */

const SEGMENTS = [
  "M 6 6 C 10.92 6.89, 15.24 8.19, 19.25 9.88",
  "M 26.74 13.68 C 30.52 15.93, 34.19 18.59, 38.03 21.66",
  "M 44.49 27.02 C 47.73 29.78, 51.17 32.79, 54.98 36.06",
];
const DOT = {cx: 69.07, cy: 47.89, r: 2.9};
const VIEWBOX = "1.9 1.9 71.3 50.1";
const STROKE = 4.2;

export type MarkTone = "paper" | "patina" | "pace";

/** paper = the neutral ink-on-paper mark; patina = the app accent; pace =
 *  the experiment — each slice in one pace color. The ball is always
 *  Paper: it is the fill, and in the app the fill ball is always light. */
function toneColors(tone: MarkTone): [string, string, string, string] {
  if (tone === "patina") return ["var(--patina)", "var(--patina)", "var(--patina)", "var(--paper)"];
  if (tone === "pace") return ["var(--ember)", "var(--paper)", "var(--patina)", "var(--paper)"];
  return ["var(--paper)", "var(--paper)", "var(--paper)", "var(--paper)"];
}

export function SlopeMark(props: {size?: number; tone?: MarkTone; label?: string; className?: string}) {
  const [a, b, c, dot] = toneColors(props.tone ?? "paper");
  return (
    <svg
      viewBox={VIEWBOX}
      // size is the mark's HEIGHT; width follows the artwork's aspect.
      height={props.size ?? 24}
      width={(props.size ?? 24) * (71.3 / 50.1)}
      className={props.className}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      style={{display: "block"}}
    >
      <g fill="none" strokeWidth={STROKE} strokeLinecap="round">
        <path d={SEGMENTS[0]} stroke={a} />
        <path d={SEGMENTS[1]} stroke={b} />
        <path d={SEGMENTS[2]} stroke={c} />
      </g>
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill={dot} />
    </svg>
  );
}

// Layered "milk wipe" section transition. Pure CSS + SVG — no Three.js, no GSAP.
// Each sheet is a 300dvh tall panel whose leading edge is a broad, rounded milk curve.
type Sheet = {
  key: string;
  fill: string;
  /** Leading edge, drawn across a 1440-wide viewBox. */
  edge: string;
  dropletOffset: number;
  dropletScale: number;
};

// Broad curved crests with rounded shoulders, a different phase per sheet so the
// layers read as separate sheets of milk rather than one flat wipe.
const SHEETS: Sheet[] = [
  {
    key: "a",
    fill: "var(--milk-back)",
    edge:
      "M0 250 C 120 70 260 40 420 190 C 560 320 700 330 850 180 C 1000 35 1180 60 1440 260",
    dropletOffset: 0,
    dropletScale: 1.25,
  },
  {
    key: "b",
    fill: "var(--milk-mid)",
    edge:
      "M0 200 C 150 45 300 60 450 210 C 600 350 730 300 880 165 C 1030 30 1230 90 1440 215",
    dropletOffset: 260,
    dropletScale: 0.95,
  },
  {
    key: "c",
    fill: "var(--milk-front)",
    edge:
      "M0 165 C 160 30 310 70 470 200 C 630 330 780 290 930 155 C 1080 25 1260 75 1440 175",
    dropletOffset: 520,
    dropletScale: 0.75,
  },
];

const DROPLETS = [
  { x: 170, r: 22 },
  { x: 330, r: 13 },
  { x: 520, r: 17 },
  { x: 700, r: 11 },
  { x: 880, r: 20 },
  { x: 1060, r: 14 },
  { x: 1250, r: 18 },
];

export default function MilkWave({
  direction = "down",
  loader = false,
}: {
  direction?: "up" | "down";
  loader?: boolean;
}) {
  return (
    <div
      className={`milk-wave ${direction} ${loader ? "loader-wave" : ""}`}
      aria-hidden="true"
      data-testid="milk-wave"
    >
      {SHEETS.map((sheet, index) => (
        <div key={sheet.key} className={`milk-sheet milk-sheet-${sheet.key}`}>
          <svg viewBox="0 0 1440 3000" preserveAspectRatio="none" focusable="false">
            <defs>
              <linearGradient
                id={`milk-highlight-${index}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
                <stop offset="45%" stopColor="#ffffff" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* The sheet itself: solid below the curved leading edge. */}
            <path
              d={`${sheet.edge} V3000 H0 Z`}
              style={{ fill: sheet.fill }}
            />

            {/* Rounded trailing highlight that trails the leading edge. */}
            <path
              d={`${sheet.edge} L1440 620 C 1260 470 1080 400 930 520 C 780 640 630 700 470 560 C 310 420 160 470 0 620 Z`}
              fill={`url(#milk-highlight-${index})`}
              opacity="0.5"
            />

            {/* Merging droplets riding just ahead of the edge. */}
            <g className="droplets" style={{ fill: sheet.fill }}>
              {DROPLETS.map((drop, i) => (
                <ellipse
                  key={`${sheet.key}-${i}`}
                  cx={drop.x + sheet.dropletOffset * (i % 2 === 0 ? 1 : -1)}
                  cy={-18 - (i % 3) * 26}
                  rx={drop.r * sheet.dropletScale * 1.35}
                  ry={drop.r * sheet.dropletScale}
                  style={{ animationDelay: `${-i * 0.35}s` }}
                />
              ))}
            </g>
          </svg>
        </div>
      ))}
    </div>
  );
}

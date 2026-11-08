import { memo } from "react";

// The room: mountains at blue hour, drawn rather than photographed, so it costs nothing to load and stays
// sharp on any screen. Ridges in four depths, the last light along the horizon, a few early stars, grain.
// Deterministic (seeded), so it never shifts between renders.

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1600;
const H = 900;

// A jagged limestone ridge: broad swells, sharp peaks, small breaks.
function ridge(seed: number, base: number, height: number, jag: number) {
  const r = rng(seed);
  const pts: [number, number][] = [];
  let x = -20;
  let y = base;
  const p1 = r() * 6;
  const p2 = r() * 6;
  while (x < W + 40) {
    const swell = Math.sin(x / 260 + p1) * 0.55 + Math.sin(x / 113 + p2) * 0.3;
    const target = base - height * (0.5 + swell * 0.5) - (r() < 0.12 ? height * 0.45 * r() : 0);
    y += (target - y) * 0.6 + (r() - 0.5) * jag;
    pts.push([x, y]);
    x += 8 + r() * 26;
  }
  return `M${-20},${H} ${pts.map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join(" ")} L${W + 40},${H} Z`;
}

const stars = (() => {
  const r = rng(7);
  return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H * 0.42, s: r() < 0.08 ? 1.3 : 0.6 + r() * 0.5, o: 0.15 + r() * 0.5 }));
})();
const RIDGES: { d: string; fill: string; rim?: boolean }[] = [
  { d: ridge(11, 600, 230, 26), fill: "#2b2438", rim: true },
  { d: ridge(23, 680, 190, 20), fill: "#1a1727" },
  { d: ridge(37, 760, 140, 16), fill: "#0f0e18" },
  { d: ridge(41, 850, 90, 10), fill: "#07080c" },
];

export const Backdrop = memo(function Backdrop({ dim = false }: { dim?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-desk">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full transition-opacity duration-700" style={{ opacity: dim ? 0.55 : 1 }}>
        <defs>
          <linearGradient id="kv-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#05060b" />
            <stop offset="0.45" stopColor="#0b1022" />
            <stop offset="0.6" stopColor="#1f1b38" />
            <stop offset="0.7" stopColor="#4a2c42" />
            <stop offset="0.78" stopColor="#8a4a42" />
          </linearGradient>
          <radialGradient id="kv-glow" cx="0.62" cy="0.74" r="0.5">
            <stop offset="0" stopColor="#f6b77a" stopOpacity="0.6" />
            <stop offset="0.35" stopColor="#c76a5b" stopOpacity="0.24" />
            <stop offset="1" stopColor="#c76a5b" stopOpacity="0" />
          </radialGradient>
          <filter id="kv-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0" />
          </filter>
        </defs>
        <rect width={W} height={H} fill="url(#kv-sky)" />
        <rect width={W} height={H} fill="url(#kv-glow)" />
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#dfe6ff" opacity={s.o} />
        ))}
        {RIDGES.map((r, i) => (
          <path key={i} d={r.d} fill={r.fill} stroke={r.rim ? "rgb(246 211 168 / 0.22)" : "none"} strokeWidth={r.rim ? 1.2 : 0} />
        ))}
        <rect width={W} height={H} filter="url(#kv-grain)" opacity="0.07" />
      </svg>
      {/* Night falls toward the bottom and the edges, so text on top stays easy to read. */}
      <div className="absolute inset-0" style={{ background: dim ? "linear-gradient(180deg, rgb(7 8 12 / 0.55), rgb(7 8 12 / 0.82) 60%, #07080c)" : "radial-gradient(120% 80% at 50% 30%, transparent 40%, rgb(7 8 12 / 0.55) 100%)" }} />
    </div>
  );
});

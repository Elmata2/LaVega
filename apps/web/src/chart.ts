/* Chart maths, as pure functions.
 *
 * The three hand-rolled SVG charts in the app each re-derived their own
 * scaling; this file is the one place that knowledge lives now, so a chart
 * component only decides what to draw, never how to map a euro to a pixel.
 *
 * Coordinates are always a 0–100 box: x = percent of the plot width, y =
 * percent of the plot height measured from the TOP. The chart components draw
 * their SVG with viewBox="0 0 100 100" preserveAspectRatio="none", so the same
 * numbers also position an HTML marker with left:x% / top:y%. That is what lets
 * every label stay real HTML at its real size while the drawing stretches — the
 * fix for the "SVG <text> shrinks to 6px on a phone" problem.
 *
 * No chart library is used anywhere: apps/web/package.json has no charting
 * dependency (only gsap, for the landing page's motion) and none was added. */

export type Pt = { x: number; y: number };

/** Round to 2 decimals — short path strings, and stable test assertions. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A value → 0–100 mapper with a vertical inset, so a line at the maximum does
 *  not sit exactly on the card's edge. `pad` is in the same 0–100 units. */
export function makeYScale(min: number, max: number, pad = 6): (value: number) => number {
  const range = max - min || 1;
  const span = 100 - pad * 2;
  return (value) => r(pad + (1 - (value - min) / range) * span);
}

/** Evenly spaced x positions across the 0–100 box. One point sits in the middle
 *  rather than at x=0, which would read as a line starting off-card. */
export function xPositions(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [50];
  return Array.from({ length: count }, (_, i) => r((i / (count - 1)) * 100));
}

/** A "nice" axis domain and its tick values: the domain is widened to round
 *  numbers so the gridlines read as 0 / 5.000 / 10.000 rather than 1.847.
 *  Always includes 0 when the data straddles it, and never returns a zero-width
 *  domain (a flat series still gets a band to sit in). */
export function niceDomain(
  min: number,
  max: number,
  tickCount = 4,
): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    // A flat series: give it a symmetric band so it draws through the middle.
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep((hi - lo) / Math.max(1, tickCount - 1));
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Guard the loop against a step that rounding could drive to 0.
  for (let v = niceMin, i = 0; v <= niceMax + step / 2 && i < 64; v += step, i++) {
    ticks.push(r(v));
  }
  return { min: niceMin, max: niceMax, ticks };
}

/** The 1 / 2 / 5 × 10ⁿ step at or above `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

/** A smooth cubic path through the points, using monotone (Fritsch–Carlson)
 *  tangents.
 *
 *  Monotone matters here for a reason that is not cosmetic: a plain
 *  Catmull-Rom curve overshoots a local minimum, so a smoothed cash-position
 *  line would dip visibly BELOW the lowest projected balance and imply a
 *  shortfall the forecast never predicted. A monotone curve is guaranteed to
 *  stay within the values it connects. */
export function smoothPath(points: Pt[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${r(points[0].x)} ${r(points[0].y)}`;

  const m = monotoneTangents(points);
  let d = `M ${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = (p1.x - p0.x) / 3;
    d += ` C ${r(p0.x + dx)} ${r(p0.y + m[i] * dx)} ${r(p1.x - dx)} ${r(p1.y - m[i + 1] * dx)} ${r(p1.x)} ${r(p1.y)}`;
  }
  return d;
}

/** Slopes at each point, limited so no segment overshoots its endpoints. */
function monotoneTangents(points: Pt[]): number[] {
  const n = points.length;
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x || 1e-6;
    secant.push((points[i + 1].y - points[i].y) / dx);
  }
  const m: number[] = Array.from({ length: n });
  m[0] = secant[0];
  m[n - 1] = secant[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (secant[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / secant[i];
    const b = m[i + 1] / secant[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      m[i] = t * a * secant[i];
      m[i + 1] = t * b * secant[i];
    }
  }
  return m;
}

/** The smooth line closed down to a baseline — the soft fill under a trend. */
export function areaPath(points: Pt[], baselineY: number): string {
  if (points.length === 0) return "";
  const line = smoothPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${r(last.x)} ${r(baselineY)} L ${r(first.x)} ${r(baselineY)} Z`;
}

/** A closed band between an upper and a lower series (the forecast's P-band).
 *  Both edges are smoothed the same way, so the band hugs the median line. */
export function bandPath(upper: Pt[], lower: Pt[]): string {
  if (upper.length === 0 || lower.length === 0) return "";
  const down = smoothPath(upper);
  const back = smoothPath([...lower].reverse());
  // Replace the return leg's "M" with an "L" so the two edges form one shape.
  return `${down} L ${back.slice(2)} Z`;
}

/** Which point a pointer at `fraction` (0–1 of the plot width) is nearest.
 *  Pure, so the hover behaviour is testable without a browser. */
export function nearestIndex(count: number, fraction: number): number {
  if (count <= 1) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * (count - 1));
}

/** Bar height as a percentage of the plot, against a shared maximum. Negative
 *  and zero values render as no bar rather than an upside-down one — every
 *  series LaVega charts is already sign-normalised by its caller. */
export function barPercent(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return r(Math.min(100, (value / max) * 100));
}

/**
 * The cost chart: group operations against search width.
 *
 * WHAT CHANGED AND WHY IT MATTERED. This series used to be labelled "measured
 * worst-case group operations" while its points came from `worstCaseOps(B)` —
 * a closed-form count derived from the search plan, never run. The arithmetic
 * was right and cross-checked against the implementation, but the word was
 * wrong: nothing had been measured. In a lab whose whole argument is that a
 * claim should be produced by the mechanism it names, that is not a caption
 * nit.
 *
 * The points now come from searches the worker actually ran to completion
 * against a target outside every bound, so `measuredOps` is a counter a search
 * returned. `predictedOps` comes back alongside and the two are shown agreeing
 * — a cross-check between two independent surfaces rather than a claim about
 * one.
 *
 * Both axes are logarithmic, which is the honest choice for a sqrt law over
 * four orders of magnitude: on linear axes the small widths collapse onto the
 * origin and the curve reads as a straight line through nothing. The axes say
 * so on the page.
 */

import { escapeHtml } from './dom';

export interface CostPoint {
  readonly bound: bigint;
  readonly width: bigint;
  /** Operations a completed search actually charged. */
  readonly measuredOps: number;
  /** What the closed form predicts. Drawn as the agreement check, not the series. */
  readonly predictedOps: number;
  /** 2*sqrt(W), the reference law. */
  readonly reference: number;
  readonly elapsedMs: number;
}

const W = 720;
const H = 300;
const PAD_L = 62;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 48;

export function costChart(
  points: readonly CostPoint[],
  currentBound: bigint,
  caption: string,
): string {
  if (points.length === 0) return '';

  const xs = points.map((p) => Math.log10(Number(p.width)));
  const ys = points.flatMap((p) => [Math.log10(p.measuredOps), Math.log10(p.reference)]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const px = (x: number): number => PAD_L + ((x - xMin) / xSpan) * (W - PAD_L - PAD_R);
  const py = (y: number): number => H - PAD_B - ((y - yMin) / ySpan) * (H - PAD_T - PAD_B);

  const path = (get: (p: CostPoint) => number): string =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(xs[i]).toFixed(1)},${py(Math.log10(get(p))).toFixed(1)}`)
      .join(' ');

  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${px(xs[i]).toFixed(1)}" cy="${py(Math.log10(p.measuredOps)).toFixed(1)}" ` +
        `r="4" fill="var(--accent-live)" />`,
    )
    .join('');

  // The slider's current B, marked on the plot. Without it the chart is a
  // static picture beside a live control, and the control appears to do
  // nothing to the thing it is about.
  const currentWidth = 2n * currentBound + 1n;
  const cx = Math.log10(Number(currentWidth));
  const inRange = cx >= xMin && cx <= xMax;
  const marker = inRange
    ? `<line x1="${px(cx).toFixed(1)}" y1="${PAD_T}" x2="${px(cx).toFixed(1)}" y2="${H - PAD_B}" ` +
      `stroke="var(--warn)" stroke-width="2" stroke-dasharray="3 3" />` +
      `<text x="${px(cx).toFixed(1)}" y="${PAD_T + 12}" text-anchor="middle" font-size="11" ` +
      `fill="var(--warn)">B now</text>`
    : '';

  const xTicks = points
    .map((p, i) => {
      const x = px(xs[i]).toFixed(1);
      return (
        `<line x1="${x}" y1="${H - PAD_B}" x2="${x}" y2="${H - PAD_B + 5}" ` +
        `stroke="var(--control-border)" stroke-width="1" />` +
        `<text x="${x}" y="${H - PAD_B + 19}" text-anchor="middle" font-size="11" ` +
        `fill="var(--text-dim)">${shortNum(p.width)}</text>`
      );
    })
    .join('');

  const yTickVals: number[] = [];
  for (let e = Math.floor(yMin); e <= Math.ceil(yMax); e++) yTickVals.push(e);
  const yTicks = yTickVals
    .filter((e) => e >= yMin - 0.001 && e <= yMax + 0.001)
    .map((e) => {
      const y = py(e).toFixed(1);
      const label = 10 ** e >= 1000 ? shortNum(BigInt(Math.round(10 ** e))) : String(10 ** e);
      return (
        `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" ` +
        `stroke="var(--border)" stroke-width="1" />` +
        `<text x="${PAD_L - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" ` +
        `font-size="11" fill="var(--text-dim)">${label}</text>`
      );
    })
    .join('');

  return (
    `<figure class="chart-wrap">` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(caption)}" ` +
    `preserveAspectRatio="xMidYMid meet">` +
    yTicks +
    `<line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}" ` +
    `stroke="var(--control-border)" stroke-width="1.5" />` +
    `<line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}" ` +
    `stroke="var(--control-border)" stroke-width="1.5" />` +
    xTicks +
    marker +
    `<path d="${path((p) => p.reference)}" fill="none" stroke="var(--info)" stroke-width="2" ` +
    `stroke-dasharray="7 5" />` +
    `<path d="${path((p) => p.measuredOps)}" fill="none" stroke="var(--accent-live)" ` +
    `stroke-width="2.5" />` +
    dots +
    `<text x="${(W + PAD_L) / 2}" y="${H - 6}" text-anchor="middle" font-size="12" ` +
    `fill="var(--text-dim)">search width W = 2B+1 (log scale)</text>` +
    `<text x="14" y="${(H - PAD_B + PAD_T) / 2}" text-anchor="middle" font-size="12" ` +
    `fill="var(--text-dim)" transform="rotate(-90 14 ${(H - PAD_B + PAD_T) / 2})">` +
    `group operations (log scale)</text>` +
    `</svg>` +
    `<ul class="legend">` +
    `<li><span class="swatch" style="background-color:var(--accent-live)"></span>` +
    `operations charged by searches that actually ran</li>` +
    `<li><span class="swatch" style="background-color:var(--info)"></span>` +
    `the law 2&#8730;W</li>` +
    `<li><span class="swatch swatch-dash" style="border-color:var(--warn)"></span>` +
    `the bound the slider is on now</li>` +
    `</ul>` +
    `<figcaption class="visually-shown">${escapeHtml(caption)}</figcaption>` +
    `</figure>`
  );
}

/** The same data as a table: the accessible form of the chart, not a fallback. */
export function costTable(points: readonly CostPoint[], currentBound: bigint): string {
  const rows = points
    .map((p) => {
      const isCurrent = p.bound === currentBound;
      return (
        `<tr${isCurrent ? ' data-row-state="current"' : ''} data-bound="${p.bound}">` +
        `<td class="num">${p.width}</td>` +
        `<td class="num" data-field="measured-${p.bound}">${p.measuredOps}</td>` +
        `<td class="num" data-field="predicted-${p.bound}">${p.predictedOps}</td>` +
        `<td class="num">${p.reference.toFixed(1)}</td>` +
        `<td class="num">${(p.measuredOps / Math.sqrt(Number(p.width))).toFixed(3)}</td>` +
        `<td class="num">${p.elapsedMs.toFixed(1)}</td>` +
        `</tr>`
      );
    })
    .join('');
  return (
    `<div class="table-scroll" tabindex="0" role="region" ` +
    `aria-label="BSGS cost by search width, as a table">` +
    `<table>` +
    `<caption>Each row is one search that ran to completion. "charged" is the counter that ` +
    `search returned; "predicted" is the closed form computed from B alone. They must agree. ` +
    `Milliseconds are machine-dependent; the operation counts are not.</caption>` +
    `<thead><tr><th class="num">width W</th><th class="num">ops charged</th>` +
    `<th class="num">ops predicted</th><th class="num">2&#8730;W</th>` +
    `<th class="num">ops / &#8730;W</th><th class="num">ms</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`
  );
}

function shortNum(n: bigint): string {
  if (n >= 1_000_000n) return `${n / 1_000_000n}M`;
  if (n >= 1_000n) return `${n / 1_000n}k`;
  return n.toString();
}

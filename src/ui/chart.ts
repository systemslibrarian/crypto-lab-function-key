/**
 * The cost chart: measured BSGS group operations against search width, with a
 * 2*sqrt(W) reference curve drawn over it.
 *
 * Drawn as inline SVG with `role="img"` and a described label, and ALWAYS
 * accompanied by the same numbers as a real table — the table is the accessible
 * version of the chart, not a fallback nobody reads. Nothing here animates.
 *
 * Both axes are logarithmic, which is the honest choice for a sqrt law over
 * four orders of magnitude: on linear axes the small widths collapse onto the
 * origin and the curve looks like a straight line through nothing. The axes are
 * labelled as logarithmic on the page so the shape is not mistaken for linear.
 */

import { escapeHtml } from './dom';

export interface CostPoint {
  readonly width: bigint;
  readonly ops: number;
  /** The reference value 2*sqrt(W), for the overlay. */
  readonly reference: number;
}

const W = 720;
const H = 300;
const PAD_L = 62;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 46;

export function costChart(points: readonly CostPoint[], caption: string): string {
  if (points.length === 0) return '';

  const xs = points.map((p) => Math.log10(Number(p.width)));
  const ys = points.flatMap((p) => [Math.log10(p.ops), Math.log10(p.reference)]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const px = (x: number) => PAD_L + ((x - xMin) / xSpan) * (W - PAD_L - PAD_R);
  const py = (y: number) => H - PAD_B - ((y - yMin) / ySpan) * (H - PAD_T - PAD_B);

  const measured = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(xs[i]).toFixed(1)},${py(Math.log10(p.ops)).toFixed(1)}`)
    .join(' ');
  const reference = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${px(xs[i]).toFixed(1)},${py(Math.log10(p.reference)).toFixed(1)}`,
    )
    .join(' ');

  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${px(xs[i]).toFixed(1)}" cy="${py(Math.log10(p.ops)).toFixed(1)}" r="4" ` +
        `fill="var(--accent-live)" />`,
    )
    .join('');

  // Axis ticks at each plotted width, and at powers of ten on the op axis.
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
      return (
        `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" ` +
        `stroke="var(--border)" stroke-width="1" />` +
        `<text x="${PAD_L - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" ` +
        `font-size="11" fill="var(--text-dim)">${10 ** e >= 1000 ? shortNum(BigInt(10 ** e)) : 10 ** e}</text>`
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
    `<path d="${reference}" fill="none" stroke="var(--warn)" stroke-width="2" ` +
    `stroke-dasharray="7 5" />` +
    `<path d="${measured}" fill="none" stroke="var(--accent-live)" stroke-width="2.5" />` +
    dots +
    `<text x="${(W + PAD_L) / 2}" y="${H - 6}" text-anchor="middle" font-size="12" ` +
    `fill="var(--text-dim)">search width W = 2B+1 (log scale)</text>` +
    `<text x="14" y="${(H - PAD_B + PAD_T) / 2}" text-anchor="middle" font-size="12" ` +
    `fill="var(--text-dim)" transform="rotate(-90 14 ${(H - PAD_B + PAD_T) / 2})">` +
    `group operations (log scale)</text>` +
    `</svg>` +
    `<ul class="legend">` +
    `<li><span class="swatch" style="background-color:var(--accent-live)"></span>` +
    `measured worst-case group operations</li>` +
    `<li><span class="swatch" style="background-color:var(--warn)"></span>` +
    `reference curve 2&#8730;W</li>` +
    `</ul>` +
    `<figcaption class="visually-shown">${escapeHtml(caption)}</figcaption>` +
    `</figure>`
  );
}

/** The same data as a table — the accessible form of the chart above. */
export function costTable(points: readonly CostPoint[]): string {
  const rows = points
    .map(
      (p) =>
        `<tr><td class="num">${p.width}</td><td class="num">${p.ops}</td>` +
        `<td class="num">${p.reference.toFixed(1)}</td>` +
        `<td class="num">${(p.ops / Math.sqrt(Number(p.width))).toFixed(3)}</td></tr>`,
    )
    .join('');
  return (
    `<div class="table-scroll" tabindex="0" role="region" ` +
    `aria-label="BSGS cost by search width, as a table">` +
    `<table>` +
    `<caption>Worst-case group operations by search width. The last column is the ` +
    `quantity the cost-law claim checks: if it stays flat, cost is proportional to ` +
    `&#8730;W.</caption>` +
    `<thead><tr><th class="num">width W</th><th class="num">group ops</th>` +
    `<th class="num">2&#8730;W</th><th class="num">ops / &#8730;W</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`
  );
}

function shortNum(n: bigint): string {
  if (n >= 1_000_000n) return `${n / 1_000_000n}M`;
  if (n >= 1_000n) return `${n / 1_000n}k`;
  return n.toString();
}

/**
 * The rank picture: issued key vectors accumulating as rows of a matrix.
 *
 * This is the lab's strongest idea and it used to be four small meter cells
 * and an affine formula in prose. The claim "each independent key removes one
 * degree of freedom, and a dependent one removes none" is a statement about a
 * matrix, so it is drawn as one.
 *
 * Every row is labelled with what it DID — raised the rank, or added an
 * equation that was already implied — computed by comparing the rank of the
 * prefix before and after it. A duplicate and a scalar multiple are both shown
 * adding zero, which is the fact stage 4's refusal depends on.
 *
 * There is no animation here. Rows appear when a key is issued and that is the
 * whole motion budget; the fleet bans decorative movement and a matrix that
 * slides around would be exactly that.
 */

import { rationalRank } from '../crypto/linalg';
import { escapeHtml, verdict } from './dom';

export interface MatrixRow {
  readonly y: readonly bigint[];
  /** The right-hand side: an output for Y x = b, or a key scalar for Y s = sk. */
  readonly rhs: string;
  /** True when this row raised the rank of everything above it. */
  readonly independent: boolean;
  readonly rankAfter: number;
}

/**
 * Work out, row by row, which keys actually bought anything.
 *
 * Computed from prefix ranks rather than from pivot bookkeeping inside the
 * solver, so this is a second opinion on the solver rather than a restatement
 * of it.
 */
export function analyseRows(
  ys: readonly (readonly bigint[])[],
  rhs: readonly string[],
  n: number,
): readonly MatrixRow[] {
  const out: MatrixRow[] = [];
  let before = 0;
  for (let i = 0; i < ys.length; i++) {
    const after = rationalRank(ys.slice(0, i + 1), n);
    out.push({
      y: ys[i],
      rhs: rhs[i] ?? '',
      independent: after > before,
      rankAfter: after,
    });
    before = after;
  }
  return out;
}

export interface MatrixOptions {
  readonly n: number;
  /** Heading above the matrix, e.g. "Y x = b". */
  readonly equation: string;
  readonly rhsHeading: string;
  readonly caption: string;
  /** Id prefix for the per-row verdicts. */
  readonly idPrefix: string;
}

export function renderMatrix(rows: readonly MatrixRow[], opts: MatrixOptions): string {
  const rank = rows.length ? rows[rows.length - 1].rankAfter : 0;
  const free = opts.n - rank;

  const head =
    `<tr><th scope="col" class="num">key</th>` +
    Array.from({ length: opts.n }, (_, i) => `<th scope="col" class="num">y<sub>${i + 1}</sub></th>`).join('') +
    `<th scope="col" class="num">${escapeHtml(opts.rhsHeading)}</th>` +
    `<th scope="col">what it bought</th></tr>`;

  const body = rows.length
    ? rows
        .map(
          (r, i) =>
            `<tr data-row-state="${r.independent ? 'pass' : 'neutral'}" data-independent="${r.independent}">` +
            `<th scope="row" class="num">k<sub>${i + 1}</sub></th>` +
            r.y
              .map(
                (v) =>
                  `<td class="num mx-cell" data-zero="${v === 0n}">${v}</td>`,
              )
              .join('') +
            `<td class="num">${escapeHtml(r.rhs)}</td>` +
            `<td>` +
            (r.independent
              ? verdict(`${opts.idPrefix}-row-${i}`, 'ok', `RANK ${r.rankAfter - 1} → ${r.rankAfter}`)
              : verdict(`${opts.idPrefix}-row-${i}`, 'info', `NOTHING — ALREADY IMPLIED`)) +
            `</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="${opts.n + 3}" class="mx-empty">No keys issued. Every vector in ` +
      `Z<sup>${opts.n}</sup> is still possible.</td></tr>`;

  // The degrees-of-freedom strip: one cell per dimension, filled as rank grows.
  const meter = Array.from({ length: opts.n }, (_, i) => {
    const filled = i < rank;
    return (
      `<span class="dim-cell" data-filled="${filled ? 'yes' : 'no'}" ` +
      `role="presentation"></span>`
    );
  }).join('');

  return (
    `<div class="matrix-block">` +
    `<p class="mx-eq"><code>${escapeHtml(opts.equation)}</code></p>` +
    `<div class="table-scroll" tabindex="0" role="region" ` +
    `aria-label="${escapeHtml(opts.caption)}">` +
    `<table class="matrix"><caption>${escapeHtml(opts.caption)}</caption>` +
    `<thead>${head}</thead><tbody>${body}</tbody></table></div>` +
    `<div class="mx-summary">` +
    `<div class="mx-meter" role="img" ` +
    `aria-label="Rank ${rank} of ${opts.n}; ${free} ${free === 1 ? 'degree' : 'degrees'} of freedom left">` +
    meter +
    `</div>` +
    `<dl class="mx-stats">` +
    `<div><dt>rank</dt><dd data-field="${opts.idPrefix}-rank">${rank} of ${opts.n}</dd></div>` +
    `<div><dt>still free</dt><dd data-field="${opts.idPrefix}-free">${free} ` +
    `${free === 1 ? 'dimension' : 'dimensions'}</dd></div>` +
    `<div><dt>keys held</dt><dd data-field="${opts.idPrefix}-held">${rows.length}</dd></div>` +
    `</dl>` +
    `</div>` +
    `</div>`
  );
}

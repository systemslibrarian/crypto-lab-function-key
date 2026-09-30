/**
 * The eight exhibits.
 *
 * Rules this file is written to, all of them from the brief:
 *
 *  - Every verdict is computed at render from a comparison of two values.
 *    There are no literal success strings selected by anything but a boolean
 *    derived from the actual computation.
 *  - x is NEVER drawn in the analyst's panel until the reconstruction has
 *    actually pinned it. Before that only the affine family is shown.
 *  - The opaque group element and the recovered integer get visibly different
 *    treatments (`.group-el` vs `.recovered-int`), and the integer is not
 *    rendered at all until the search has finished.
 *  - Every fixture row prints BOTH the computed and the expected value, always,
 *    not only when they differ.
 */

import {
  combineCiphertexts,
  decrypt,
  decryptToElement,
  encrypt,
  keyDer,
  setup,
  type ScalarSource,
} from '../crypto/ipfe';
import { seededSource, systemSource } from '../crypto/prng';
import { GROUP_ORDER, toHex } from '../crypto/ristretto';
import { MAX_BOUND, dlogSymmetric, tableSizeFor, worstCaseOps } from '../crypto/dlog';
import { fToString } from '../crypto/linalg';
import {
  WHY_PERMITTED,
  forgeKey,
  knowledgeFrom,
  ranks,
  recoverMasterSecret,
  type Observation,
} from '../crypto/attacks';
import {
  CORRECTNESS_FIXTURES,
  COST_LAW_BOUNDS,
  DEFAULT_BOUND,
  NEVER_ISSUED_Y,
  PARTIAL_KNOWLEDGE,
  RANK_DEFICIENT_YS,
} from '../crypto/fixtures';
import type { Ciphertext, FunctionalKey, KeyPair } from '../crypto/types';
import { ENTRY_MAX, ENTRY_MIN, MAX_N } from '../crypto/types';
import { costChart, costTable, type CostPoint } from './chart';
import { escapeHtml, kv, vec, verdict, verdictFor } from './dom';

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export interface LabState {
  n: number;
  x: bigint[];
  y: bigint[];
  bound: bigint;
  /** Live keypair and ciphertext for acts 1-3. Regenerated on demand. */
  keys: KeyPair;
  ciphertext: Ciphertext;
  /**
   * The ciphertext this one replaced, kept ONLY so the page can show that a
   * re-encryption changed every component. Invariant 2 is otherwise invisible:
   * the decrypted element is g^<x,y>, which is deterministic by construction,
   * so comparing decryptions can never demonstrate randomized encryption.
   */
  previous: Ciphertext | null;
  /** Indices into the act-4 offer list that the analyst has taken. */
  collected: number[];
  /** Indices into the act-5 offer list. */
  aloneCollected: number[];
}

/** The y vectors act 4 offers, in order. */
export const ACT4_OFFERS: readonly (readonly bigint[])[] = [
  PARTIAL_KNOWLEDGE.keys[0].y,
  PARTIAL_KNOWLEDGE.keys[1].y,
  [1n, 0n, 0n, 0n],
  [0n, 0n, 1n, 0n],
];

/**
 * The y vectors act 5 offers. The first four are deliberately rank-deficient so
 * the refusal is reachable before the recovery is.
 */
export const ACT5_OFFERS: readonly (readonly bigint[])[] = [
  ...RANK_DEFICIENT_YS,
  [0n, 1n, 0n, 0n],
  [0n, 0n, 0n, 1n],
];

export function makeState(source: ScalarSource = systemSource()): LabState {
  const n = 4;
  const x = [3n, 1n, 4n, 1n];
  const y = [2n, 0n, 1n, 5n];
  const keys = setup(n, source);
  return {
    n,
    x,
    y,
    bound: DEFAULT_BOUND,
    keys,
    ciphertext: encrypt(keys.mpk, x, source),
    previous: null,
    collected: [],
    aloneCollected: [],
  };
}

/** Re-run Setup and Encrypt with fresh randomness. */
export function regenerate(state: LabState): void {
  const source = systemSource();
  state.keys = setup(state.n, source);
  state.previous = state.ciphertext;
  state.ciphertext = encrypt(state.keys.mpk, state.x, source);
}

/** Re-encrypt the current x without changing the keys. */
export function reencrypt(state: LabState): void {
  state.previous = state.ciphertext;
  state.ciphertext = encrypt(state.keys.mpk, state.x, systemSource());
}

/** The independent integer dot product, computed in the UI from x and y. */
function dot(x: readonly bigint[], y: readonly bigint[]): bigint {
  let acc = 0n;
  for (let i = 0; i < x.length; i++) acc += x[i] * y[i];
  return acc;
}

function vecInputs(name: string, values: readonly bigint[], label: string): string {
  return (
    `<div class="field"><label id="lbl-${name}">${escapeHtml(label)}</label>` +
    `<div class="vec-inputs" role="group" aria-labelledby="lbl-${name}">` +
    values
      .map(
        (v, i) =>
          `<input type="number" data-vec="${name}" data-index="${i}" value="${v}" ` +
          `min="${ENTRY_MIN}" max="${ENTRY_MAX}" step="1" ` +
          `aria-label="${escapeHtml(label)} component ${i + 1}" />`,
      )
      .join('') +
    `</div></div>`
  );
}

/* ------------------------------------------------------------------ *
 * 1 — Two kinds of key
 * ------------------------------------------------------------------ */

export function renderKeys(state: LabState): string {
  const { mpk, msk } = state.keys;
  const key = keyDer(msk, state.y);
  const expected = dot(state.x, state.y);
  const result = decrypt(state.ciphertext, key, state.bound);
  const got = result.dlog.found ? result.dlog.value : null;

  return (
    `<div class="card">` +
    `<span class="step-num">EXHIBIT 1</span>` +
    `<h2>The same ciphertext, opened two ways</h2>` +
    `<p>` +
    `On the left is what the authority holds: the master secret <code>s</code>, which can ` +
    `reconstruct the whole vector. On the right is what an analyst holds: one functional key ` +
    `for the weight vector <code>y</code>. <strong>The second key answers one question about ` +
    `the data.</strong> Change either vector and both sides update.` +
    `</p>` +
    `<div class="controls">` +
    vecInputs('x', state.x, 'Encrypted vector x') +
    vecInputs('y', state.y, 'Weight vector y') +
    `<div class="field"><label for="n-select">Dimension n</label>` +
    `<select id="n-select">` +
    Array.from({ length: MAX_N }, (_, i) => i + 1)
      .map(
        (i) => `<option value="${i}"${i === state.n ? ' selected' : ''}>${i}</option>`,
      )
      .join('') +
    `</select></div>` +
    `<button class="btn" id="btn-reencrypt" type="button">Encrypt again</button>` +
    `<button class="btn" id="btn-regen" type="button">New master key</button>` +
    `</div>` +
    `<div class="compare-grid">` +
    `<div>` +
    `<span class="tag">AUTHORITY · holds s</span>` +
    `<h3>Ordinary decryption</h3>` +
    `<p>Releases the whole vector. This is what encryption normally means.</p>` +
    kv([['x recovered', `<strong>${vec(state.x)}</strong>`]]) +
    `<p class="footnote">Every component, in the clear.</p>` +
    `</div>` +
    `<div>` +
    `<span class="tag">ANALYST · holds sk<sub>y</sub></span>` +
    `<h3>Functional key for y</h3>` +
    `<p>Releases one number: the weighted total. Nothing else about x.</p>` +
    kv([
      ['y authorized', vec(state.y)],
      [
        'answer &lt;x, y&gt;',
        got === null
          ? `<span class="pending-int">not in range</span>`
          : `<span class="recovered-int">${got}</span>`,
      ],
    ]) +
    `<p>` +
    verdictFor(
      'correctness',
      got !== null && got === expected,
      'MATCHES THE DOT PRODUCT',
      'DOES NOT MATCH',
    ) +
    `</p>` +
    `<p class="footnote">` +
    `computed by the scheme: <code data-field="computed">${got === null ? 'no value' : got}</code> · ` +
    `expected from x and y: <code data-field="expected">${expected}</code>` +
    `</p>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `<div class="note-box">` +
    `<h3>What the analyst's key does not contain</h3>` +
    `<p>` +
    `The functional key is a single scalar, <code>sk<sub>y</sub> = &lt;s, y&gt; mod &#8467;</code> ` +
    `— one number, not a vector. It is the same size whether n is 1 or 8, and it carries no ` +
    `record of x at all; it was derived before this ciphertext existed. That is why the same key ` +
    `works on every ciphertext the authority ever issues under this master key, which becomes ` +
    `the point of exhibit 5.` +
    `</p>` +
    kv([
      ['sk<sub>y</sub> (this key, mod &#8467;)', `<span class="group-el" data-field="sk">${key.sk}</span>`],
      ['mpk h<sub>1</sub> = g<sup>s<sub>1</sub></sup>', `<span class="group-el">${toHex(mpk.h[0])}</span>`],
    ]) +
    `<p>` +
    verdictFor(
      'scalar-canonical',
      key.sk >= 0n && key.sk < GROUP_ORDER,
      'THE KEY IS A CANONICAL SCALAR IN [0, &#8467;)',
      'THE KEY IS NOT REDUCED MOD &#8467;',
    ) +
    `</p>` +
    `<p class="footnote">` +
    `That check is not decoration. Entries of x and y are <strong>integers</strong> and can be ` +
    `negative; keys are <strong>scalars mod &#8467;</strong>. They are different kinds of thing, ` +
    `and the raw inner product &lt;s, y&gt; is a signed integer that may be negative or larger ` +
    `than &#8467; before it is reduced. The lab never mixes the two silently, so the reduction is ` +
    `asserted here rather than assumed &mdash; 0 &le; sk<sub>y</sub> &lt; &#8467; = ` +
    `<code>${GROUP_ORDER}</code>.` +
    `</p>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ *
 * 2 — Decrypt, in two visible halves
 * ------------------------------------------------------------------ */

export function renderDecrypt(state: LabState): string {
  const key = keyDer(state.keys.msk, state.y);
  const element = decryptToElement(state.ciphertext, key);
  const search = dlogSymmetric(element, state.bound);
  const expected = dot(state.x, state.y);
  const found = search.found ? search.value : null;

  // Invariant 2, made visible. The ciphertext components are what change
  // under a fresh r; the decrypted element is not, and showing both side by
  // side is the clearest way to say why.
  const prev = state.previous;
  const componentRows = state.ciphertext.ct
    .map((c, i) => {
      const now = toHex(c);
      const before = prev && prev.n === state.ciphertext.n ? toHex(prev.ct[i]) : null;
      const changed = before !== null && before !== now;
      return (
        `<tr data-row-state="${before === null ? 'pass' : changed ? 'pass' : 'fail'}">` +
        `<td class="num">ct<sub>${i + 1}</sub></td>` +
        `<td><span class="group-el" data-field="ct-now-${i}">${now}</span></td>` +
        (before === null
          ? `<td class="num">&mdash;</td>`
          : `<td>${verdictFor(`component-${i}`, changed, 'CHANGED', 'IDENTICAL')}</td>`)
      );
    })
    .join('');
  const ct0Now = toHex(state.ciphertext.ct0);
  const ct0Before = prev ? toHex(prev.ct0) : null;
  const allChanged =
    prev !== null &&
    prev.n === state.ciphertext.n &&
    ct0Before !== ct0Now &&
    state.ciphertext.ct.every((c, i) => toHex(c) !== toHex(prev.ct[i]));

  return (
    `<div class="card">` +
    `<span class="step-num">EXHIBIT 2</span>` +
    `<h2>Decryption finishes before the answer appears</h2>` +
    `<p>` +
    `This is the step that surprises people. Applying the functional key succeeds immediately ` +
    `and produces a group element. That element <em>is</em> the answer — but encoded as ` +
    `<code>g<sup>&lt;x, y&gt;</sup></code>, and 32 bytes of ristretto255 encoding tell you ` +
    `nothing about the exponent. Getting the integer back is a separate search.` +
    `</p>` +
    `<h3>Step 0 &mdash; the ciphertext itself</h3>` +
    `<p class="footnote">` +
    `ct<sub>0</sub> = g<sup>r</sup> and ct<sub>i</sub> = h<sub>i</sub><sup>r</sup> &middot; ` +
    `g<sup>x<sub>i</sub></sup>, for one fresh r per encryption. Press ` +
    `<strong>Encrypt again</strong> in exhibit 1 and every line below changes.` +
    `</p>` +
    `<div class="table-scroll" tabindex="0" role="region" ` +
    `aria-label="Ciphertext components, compared against the previous encryption">` +
    `<table><caption>` +
    (prev === null
      ? 'Encrypt the same vector again to compare these against the previous ciphertext.'
      : 'Compared componentwise against the ciphertext this one replaced.') +
    `</caption>` +
    `<thead><tr><th class="num">component</th><th>value now</th>` +
    `<th>vs previous</th></tr></thead><tbody>` +
    `<tr data-row-state="pass"><td class="num">ct<sub>0</sub></td>` +
    `<td><span class="group-el" data-field="ct0-now">${ct0Now}</span></td>` +
    (ct0Before === null
      ? `<td class="num">&mdash;</td>`
      : `<td>${verdictFor('component-ct0', ct0Before !== ct0Now, 'CHANGED', 'IDENTICAL')}</td>`) +
    `</tr>` +
    componentRows +
    `</tbody></table></div>` +
    (prev === null
      ? `<p>${verdict('randomized', 'info', 'NO PREVIOUS CIPHERTEXT TO COMPARE YET')}</p>`
      : `<p>${verdictFor(
          'randomized',
          allChanged,
          'EVERY COMPONENT CHANGED UNDER A FRESH r',
          'SOME COMPONENT REPEATED',
        )}</p>`) +
    `<p class="footnote">` +
    `And yet the group element in step 1 below is <strong>unchanged</strong>. That is not a ` +
    `contradiction, it is the correctness identity: the r in every ct<sub>i</sub> cancels ` +
    `against the r in ct<sub>0</sub><sup>sk<sub>y</sub></sup>, so two completely different ` +
    `ciphertexts of the same x combine to the same g<sup>&lt;x, y&gt;</sup>. The randomness ` +
    `hides the ciphertext; it was never meant to hide the answer.` +
    `</p>` +
    `<p class="arrow-down" aria-hidden="true">&darr;</p>` +
    `<h3>Step 1 &mdash; combine the ciphertext under y</h3>` +
    `<p class="footnote">` +
    `&prod;<sub>i</sub> ct<sub>i</sub><sup>y<sub>i</sub></sup> &divide; ` +
    `ct<sub>0</sub><sup>sk<sub>y</sub></sup>, exactly as ABDP15 Construction 3.1 writes it. ` +
    `The r terms cancel; what survives is the inner product in the exponent.` +
    `</p>` +
    `<span class="group-el" data-field="element">${toHex(element)}</span>` +
    `<p class="footnote">` +
    `An opaque group element. Decryption has already worked. There is no arithmetic left to do ` +
    `on the ciphertext, and still no number on screen.` +
    `</p>` +
    `<p class="arrow-down" aria-hidden="true">&darr;</p>` +
    `<h3>Step 2 &mdash; search for the exponent</h3>` +
    `<p class="footnote">` +
    `Baby-step giant-step over the symmetric range [&minus;B, B], B = ${state.bound}. ` +
    `Table of ${search.tableSize} points; ${search.ops.total} group operations charged.` +
    `</p>` +
    (found === null
      ? `<p><span class="pending-int">no value &mdash; not found in range</span></p>` +
        `<p>` +
        verdict('range-search', 'warn', 'SEARCH EXHAUSTED, NO VALUE RETURNED') +
        `</p>` +
        `<p class="footnote">` +
        `This is the honest failure, not a wrapped answer. The true inner product is ` +
        `<code data-field="expected">${expected}</code>, outside the range. Widen B in exhibit 3.` +
        `</p>`
      : `<p><span class="recovered-int" data-field="recovered">${found}</span></p>` +
        `<p>` +
        verdictFor(
          'decrypt-exact',
          found === expected,
          'EXPONENT RECOVERED EXACTLY',
          'RECOVERED VALUE IS WRONG',
        ) +
        `</p>` +
        `<p class="footnote">` +
        `recovered by search: <code data-field="computed">${found}</code> · ` +
        `expected from x and y: <code data-field="expected">${expected}</code>` +
        `</p>`) +
    `</div>` +
    `<div class="note-box">` +
    `<h3>Why this is a real limit and not an implementation detail</h3>` +
    `<p>` +
    `The scheme hands back <code>g<sup>&lt;x, y&gt;</sup></code> and nothing better. Recovering ` +
    `the integer means solving a discrete log, which is the problem the security of the whole ` +
    `construction rests on being hard. It is only tractable here because the answer is known to ` +
    `be small &mdash; so DDH-based IPFE works for bounded statistics and not for arbitrary ones. ` +
    `ALS16 removes this restriction using Paillier rather than by searching faster; ` +
    `see exhibit 8.` +
    `</p>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ *
 * 3 — The bottleneck, measured
 * ------------------------------------------------------------------ */

export function renderBottleneck(state: LabState): string {
  const points: CostPoint[] = COST_LAW_BOUNDS.map((b) => {
    const o = worstCaseOps(b);
    const width = 2n * b + 1n;
    return {
      width,
      ops: o.babySteps + o.giantSteps,
      reference: 2 * Math.sqrt(Number(width)),
    };
  });

  const ratios = points.map((p) => p.ops / Math.sqrt(Number(p.width)));
  const minR = Math.min(...ratios);
  const maxR = Math.max(...ratios);
  const spread = maxR / minR;
  const TOLERANCE = 1.2;

  // The out-of-range demonstration, at the edge, in both directions. Computed
  // live rather than described.
  //
  // This uses its own seeded n = 2 keypair rather than the page's live one,
  // because the demonstration needs a FIXED product of exactly 25 to sit at
  // the +/-B and +/-(B+1) boundaries; deriving it from the live vectors would
  // make the boundary move with the controls and stop demonstrating an edge.
  const edgeSource = seededSource('edge-demo');
  const edgePair = setup(2, edgeSource);
  const edgeKey2 = keyDer(edgePair.msk, [5n, 0n]);
  const ctPos = encrypt(edgePair.mpk, [5n, 0n], edgeSource);
  const ctNeg = encrypt(edgePair.mpk, [-5n, 0n], edgeSource);
  const atBound = decrypt(ctPos, edgeKey2, 25n);
  const overBound = decrypt(ctPos, edgeKey2, 24n);
  const negAtBound = decrypt(ctNeg, edgeKey2, 25n);
  const negOverBound = decrypt(ctNeg, edgeKey2, 24n);

  const liveOps = worstCaseOps(state.bound);

  const edgeRows: readonly [string, boolean, string, string][] = [
    ['+25 with B = 25 (inside)', atBound.dlog.found, atBound.dlog.found ? String(atBound.dlog.value) : 'no value', '25'],
    ['+25 with B = 24 (outside)', !overBound.dlog.found, overBound.dlog.found ? String(overBound.dlog.value) : 'no value', 'no value'],
    ['&minus;25 with B = 25 (inside)', negAtBound.dlog.found, negAtBound.dlog.found ? String(negAtBound.dlog.value) : 'no value', '-25'],
    ['&minus;25 with B = 24 (outside)', !negOverBound.dlog.found, negOverBound.dlog.found ? String(negOverBound.dlog.value) : 'no value', 'no value'],
  ];
  const edgeAllCorrect = edgeRows.every(([, ok]) => ok);
  const negativeHalfWorks = negAtBound.dlog.found && negAtBound.dlog.value === -25n;

  return (
    `<div class="card">` +
    `<span class="step-num">EXHIBIT 3</span>` +
    `<h2>What the search costs, and where it gives up</h2>` +
    `<p>` +
    `The bound B is a promise about the answer: "the inner product will be somewhere in ` +
    `[&minus;B, B]". Widening it buys a larger range of usable statistics and costs group ` +
    `operations. Baby-step giant-step makes that trade at &#8730;W rather than W, which is the ` +
    `only reason a bound in the millions is reachable in a browser at all.` +
    `</p>` +
    `<div class="controls">` +
    `<div class="field">` +
    `<label for="bound-slider">Bound B &mdash; exponent of 2 (B = ${state.bound})</label>` +
    `<input type="range" id="bound-slider" min="3" max="21" step="1" ` +
    `value="${log2(state.bound)}" aria-describedby="bound-readout" />` +
    `</div>` +
    `</div>` +
    `<p id="bound-readout" role="status" aria-live="polite">` +
    `B = ${state.bound}; width W = ${2n * state.bound + 1n}; baby-step table ` +
    `${tableSizeFor(state.bound)} points; worst-case ` +
    `${liveOps.babySteps + liveOps.giantSteps} group operations.` +
    `</p>` +
    `<p class="footnote">` +
    `At the shipped default of B = ${DEFAULT_BOUND} the search cannot fail: the largest inner ` +
    `product this lab can produce is 8 &times; 9 &times; 9 = 648, which is inside it. That is ` +
    `the right default &mdash; but it also means you have to <strong>lower</strong> B below the ` +
    `current answer to see the refusal, rather than raising the inputs. The boundary table below ` +
    `does it at a fixed B so the failure is on screen either way.` +
    `</p>` +
    `<p class="footnote">` +
    `The cap is B = ${MAX_BOUND}, chosen by measurement: a worst-case miss there costs ` +
    `${worstCaseOps(MAX_BOUND).total} group operations and returns in roughly 0.4 s on the ` +
    `machine this was built on. Wall-clock is machine-dependent; the operation count is not, ` +
    `which is why the chart plots operations.` +
    `</p>` +
    costChart(
      points,
      'Worst-case BSGS group operations against search width, on logarithmic axes, ' +
        'with the reference curve two times the square root of W drawn over the measured values.',
    ) +
    costTable(points) +
    `<p>` +
    verdictFor(
      'cost-law',
      spread < TOLERANCE,
      `SQUARE-ROOT SCALING HOLDS ACROSS ${points.length} WIDTHS`,
      'SCALING IS NOT SQUARE-ROOT',
    ) +
    `</p>` +
    `<p class="footnote">` +
    `ops &divide; &#8730;W ranges over <code data-field="ratio-min">${minR.toFixed(3)}</code> to ` +
    `<code data-field="ratio-max">${maxR.toFixed(3)}</code> across widths ` +
    `${points[0].width} to ${points[points.length - 1].width}. Spread ` +
    `<code data-field="ratio-spread">${spread.toFixed(3)}</code>, tolerance ` +
    `<code data-field="ratio-tolerance">${TOLERANCE}</code>. A cost proportional to W instead ` +
    `of &#8730;W would push this spread past ${Math.round(Number(points[points.length - 1].width) / Number(points[0].width)) / 100}.` +
    `</p>` +
    `</div>` +
    `<div class="card">` +
    `<h3>At the edge: the failure is a failure</h3>` +
    `<p>` +
    `An inner product one step outside the range does not come back wrong. It does not come ` +
    `back at all. Both signs are shown because the range is symmetric &mdash; a search that ` +
    `only covered [0, B] would silently lose every negative answer while still passing all the ` +
    `positive cases.` +
    `</p>` +
    `<div class="table-scroll" tabindex="0" role="region" aria-label="Boundary behaviour of the bounded search">` +
    `<table>` +
    `<caption>Both the computed and the expected result on every row, always.</caption>` +
    `<thead><tr><th>case</th><th class="num">returned</th><th class="num">expected</th>` +
    `<th>verdict</th></tr></thead><tbody>` +
    edgeRows
      .map(
        ([label, ok, got, want], i) =>
          `<tr data-row-state="${ok ? 'pass' : 'fail'}"><td>${label}</td>` +
          `<td class="num">${escapeHtml(got)}</td><td class="num">${escapeHtml(want)}</td>` +
          `<td>${verdictFor(`edge-${i}`, ok, 'AS SPECIFIED', 'WRONG')}</td></tr>`,
      )
      .join('') +
    `</tbody></table></div>` +
    `<p>` +
    verdictFor(
      'range-edge',
      edgeAllCorrect && negativeHalfWorks,
      'SYMMETRIC RANGE: BOTH SIGNS INSIDE, BOTH REFUSED OUTSIDE',
      'RANGE BEHAVIOUR IS WRONG',
    ) +
    `</p>` +
    `</div>`
  );
}

function log2(n: bigint): number {
  let e = 0;
  let v = n;
  while (v > 1n) {
    v >>= 1n;
    e++;
  }
  return e;
}

/* ------------------------------------------------------------------ *
 * 4 — Collect keys, watch the family shrink
 * ------------------------------------------------------------------ */

export function renderCollect(state: LabState): string {
  const { n, xA, xB } = PARTIAL_KNOWLEDGE;
  const source = seededSource(PARTIAL_KNOWLEDGE.seed);
  const pair = setup(n, source);
  const ct = encrypt(pair.mpk, xA, source);

  const taken = state.collected;
  const observations: Observation[] = [];
  for (const idx of taken) {
    const y = ACT4_OFFERS[idx];
    const r = decrypt(ct, keyDer(pair.msk, y), DEFAULT_BOUND);
    if (r.dlog.found) observations.push({ y, output: r.dlog.value });
  }

  const state4 = knowledgeFrom(observations, n);

  // Is xB still consistent with everything collected? Checked by evaluating the
  // real dot products, not by consulting the solver.
  const xbConsistent = observations.every((o) => dot(xB, o.y) === o.output);
  const xaConsistent = observations.every((o) => dot(xA, o.y) === o.output);

  const offers = ACT4_OFFERS.map((y, i) => {
    const already = taken.includes(i);
    return (
      `<li>` +
      `y = ${vec(y)} ` +
      (already
        ? `<span class="verdict verdict-info" data-verdict="offer-${i}">` +
          `<i class="verdict-icon" aria-hidden="true">i</i><span>ISSUED</span></span>`
        : `<button class="btn" type="button" data-request-key="${i}" ` +
          `aria-label="Request a functional key for y equals ${y.join(', ')}">Request key</button>`) +
      `</li>`
    );
  }).join('');

  const dimMeter = Array.from({ length: n }, (_, i) => {
    const filled = i < state4.rank;
    return (
      `<span class="dim-cell" data-filled="${filled ? 'yes' : 'no'}" ` +
      `role="presentation"></span>`
    );
  }).join('');

  return (
    `<div class="card">` +
    `<span class="step-num">EXHIBIT 4</span>` +
    `<h2>Each key narrows the field. Count them.</h2>` +
    `<p>` +
    `The analyst asks for keys one at a time, against a single fixed ciphertext of a 4-component ` +
    `vector. After each key, the panel shows what is now known about x &mdash; not as a guess, ` +
    `but as the exact set of vectors still consistent with every answer received so far.` +
    `</p>` +
    `<div class="controls">` +
    `<button class="btn" type="button" id="btn-reset-collect">Return all keys</button>` +
    `</div>` +
    `<h3>Keys available from the authority</h3>` +
    `<ul class="key-list" role="list" aria-label="Functional keys available">${offers}</ul>` +
    `<h3>What the analyst knows</h3>` +
    `<div class="dim-meter" role="img" ` +
    `aria-label="Rank ${state4.rank} of ${n}; ${state4.dimension} dimensions still free">` +
    dimMeter +
    `</div>` +
    kv([
      ['keys held', `${observations.length}`],
      ['rank of the y vectors', `${state4.rank} of ${n}`],
      ['solution set dimension', `${state4.dimension}`],
      [
        'x consistent with the answers',
        state4.pinned
          ? `<strong>${(state4.recovered ?? []).map(fToString).join(', ')}</strong>`
          : `<span data-field="family">${escapeHtml(state4.description)}</span>`,
      ],
    ]) +
    `<p role="status" aria-live="polite" data-field="knowledge-status">` +
    (state4.pinned
      ? verdict('partial', 'warn', 'x IS NOW DETERMINED — ONE POINT')
      : verdictFor(
          'partial',
          !state4.pinned && state4.dimension === n - state4.rank,
          `x NOT DETERMINED — ${state4.dimension} FREE DIMENSIONS REMAIN`,
          'DIMENSION REPORTING IS WRONG',
        )) +
    `</p>` +
    (state4.pinned
      ? ''
      : `<p class="footnote">` +
        `Only the family is drawn, deliberately. There is no single x to show yet, and drawing ` +
        `one would be the lie this exhibit exists to avoid.` +
        `</p>`) +
    `</div>` +
    (observations.length > 0
      ? `<div class="${state4.pinned ? 'card' : 'alarm-box'}">` +
        `<h3>${state4.pinned ? 'Both candidates collapse to one' : 'Two different vectors, identical answers'}</h3>` +
        `<p>` +
        `These two vectors differ in their first two components. While the keys held span only ` +
        `directions orthogonal to that difference, every answer they produce is identical, so ` +
        `no amount of looking at the outputs can separate them.` +
        `</p>` +
        `<div class="table-scroll" tabindex="0" role="region" ` +
        `aria-label="Two candidate vectors against the answers received">` +
        `<table><thead><tr><th>candidate</th>` +
        observations.map((o) => `<th class="num">y = ${vec(o.y)}</th>`).join('') +
        `<th>verdict</th></tr></thead><tbody>` +
        `<tr><td class="num">x<sub>A</sub> = ${vec(xA)}</td>` +
        observations.map((o) => `<td class="num">${dot(xA, o.y)}</td>`).join('') +
        `<td>${verdictFor('xa-consistent', xaConsistent, 'CONSISTENT', 'RULED OUT')}</td></tr>` +
        `<tr><td class="num">x<sub>B</sub> = ${vec(xB)}</td>` +
        observations.map((o) => `<td class="num">${dot(xB, o.y)}</td>`).join('') +
        `<td>${verdictFor('xb-consistent', xbConsistent, 'CONSISTENT', 'RULED OUT')}</td></tr>` +
        `<tr><td class="num">answer received</td>` +
        observations.map((o) => `<td class="num">${o.output}</td>`).join('') +
        `<td>&mdash;</td></tr>` +
        `</tbody></table></div>` +
        `<p>` +
        verdictFor(
          'two-candidates',
          state4.pinned ? xaConsistent && !xbConsistent : xaConsistent && xbConsistent,
          state4.pinned
            ? 'ONLY ONE CANDIDATE SURVIVES'
            : 'BOTH REMAIN CONSISTENT — ONE KEY DOES NOT DETERMINE x',
          'CANDIDATE BOOKKEEPING IS WRONG',
        ) +
        `</p>` +
        (state4.pinned
          ? `<p class="footnote">` +
            `At full rank the reconstruction is exact: rational Gaussian elimination over ` +
            `BigInt fractions, every recovered coordinate landing on an integer with ` +
            `denominator 1. No rounding was involved, so "exact" is a property of the ` +
            `arithmetic rather than a description of the output.` +
            `</p>` +
            `<p>` +
            verdictFor(
              'reconstruct',
              state4.pinned &&
                (state4.recovered ?? []).every((f, i) => f.den === 1n && f.num === xA[i]),
              'x RECOVERED EXACTLY, AND IT IS THE ENCRYPTED VECTOR',
              'RECONSTRUCTION DOES NOT MATCH THE ENCRYPTED VECTOR',
            ) +
            `</p>` +
            `<p class="footnote">` +
            `recovered: <code data-field="computed">` +
            `${(state4.recovered ?? []).map(fToString).join(', ')}</code> · ` +
            `encrypted: <code data-field="expected">${xA.join(', ')}</code>` +
            `</p>`
          : '') +
        `</div>`
      : '')
  );
}

/* ------------------------------------------------------------------ *
 * 5 — Keys alone: no ciphertext at all
 * ------------------------------------------------------------------ */

export function renderAlone(state: LabState): string {
  const n = 4;
  const source = seededSource('function-key/alone');
  const pair = setup(n, source);

  const taken = state.aloneCollected;
  const held: FunctionalKey[] = taken.map((i) => keyDer(pair.msk, ACT5_OFFERS[i]));
  const heldYs = held.map((k) => k.y);
  const r = ranks(heldYs, n);
  const recovery = recoverMasterSecret(held, n);

  const offers = ACT5_OFFERS.map((y, i) => {
    const already = taken.includes(i);
    return (
      `<li>y = ${vec(y)} ` +
      (already
        ? `<span class="verdict verdict-info" data-verdict="alone-offer-${i}">` +
          `<i class="verdict-icon" aria-hidden="true">i</i><span>HELD</span></span>`
        : `<button class="btn" type="button" data-request-alone="${i}" ` +
          `aria-label="Collect the functional key for y equals ${y.join(', ')}">Collect key</button>`) +
      `</li>`
    );
  }).join('');

  let proof = '';
  if (recovery.kind === 'recovered') {
    // The proof: derive a key for a vector the authority never issued, then
    // decrypt a FRESH ciphertext with it.
    const forged = forgeKey(recovery.s, NEVER_ISSUED_Y);
    const freshX = [4n, -1n, 3n, 2n];
    const freshCt = encrypt(pair.mpk, freshX, systemSource());
    const out = decrypt(freshCt, forged, DEFAULT_BOUND);
    const expected = dot(freshX, NEVER_ISSUED_Y);
    const got = out.dlog.found ? out.dlog.value : null;
    const neverIssued = !taken.some((i) =>
      ACT5_OFFERS[i].every((v, j) => v === NEVER_ISSUED_Y[j]),
    );

    proof =
      `<div class="alarm-box">` +
      `<h3>A key the authority never approved</h3>` +
      `<p>` +
      `With s in hand, the analyst runs the authority's own KeyDer on a weight vector that was ` +
      `never requested and never issued, and applies it to a ciphertext encrypted after the ` +
      `fact. The answer is correct. Nothing in the scheme can tell the difference, because ` +
      `there is no difference: this is a genuine key.` +
      `</p>` +
      kv([
        ['y never issued', `${vec(NEVER_ISSUED_Y)} ${verdictFor('never-issued', neverIssued, 'NOT AMONG THE COLLECTED KEYS', 'THIS KEY WAS COLLECTED')}`],
        ['forged sk<sub>y</sub>', `<span class="group-el">${forged.sk}</span>`],
        ['authority&#39;s own sk<sub>y</sub>', `<span class="group-el">${keyDer(pair.msk, NEVER_ISSUED_Y).sk}</span>`],
        [
          'fresh ciphertext decrypts to',
          got === null ? `<span class="pending-int">not in range</span>` : `<span class="recovered-int">${got}</span>`,
        ],
      ]) +
      `<p>` +
      verdictFor(
        'master',
        got !== null && got === expected && forged.sk === keyDer(pair.msk, NEVER_ISSUED_Y).sk,
        'FORGED KEY DECRYPTS A FRESH CIPHERTEXT CORRECTLY',
        'FORGED KEY DOES NOT WORK',
      ) +
      `</p>` +
      `<p class="footnote">` +
      `decrypted: <code data-field="computed">${got === null ? 'none' : got}</code> · ` +
      `expected &lt;x&#39;, y&#39;&gt;: <code data-field="expected">${expected}</code>` +
      `</p>` +
      `</div>` +
      `<div class="note-box">` +
      `<h3>${escapeHtml(WHY_PERMITTED.headline)}</h3>` +
      `<p data-field="why-permitted">${escapeHtml(WHY_PERMITTED.short)}</p>` +
      `<ol>` +
      WHY_PERMITTED.chain.map((c) => `<li>${escapeHtml(c)}</li>`).join('') +
      `</ol>` +
      `<p class="footnote" data-field="not-claimed">${escapeHtml(WHY_PERMITTED.notClaimed)}</p>` +
      `</div>`;
  }

  return (
    `<div class="card">` +
    `<span class="step-num">EXHIBIT 5</span>` +
    `<h2>Enough keys are the master secret &mdash; with no ciphertext in sight</h2>` +
    `<p>` +
    `Nothing on this page is encrypted until the last step. The analyst holds only pairs ` +
    `<code>(y, sk<sub>y</sub>)</code>. Since KeyDer is ` +
    `<code>sk<sub>y</sub> = &lt;s, y&gt; mod &#8467;</code>, each key is one linear equation in ` +
    `the unknown s. Collect n independent ones and it is a square system over a prime field: ` +
    `solve it, and s falls out. No discrete log, no group operation, nothing hard.` +
    `</p>` +
    `<div class="controls">` +
    `<button class="btn" type="button" id="btn-reset-alone">Return all keys</button>` +
    `</div>` +
    `<h3>Keys the analyst has collected</h3>` +
    `<ul class="key-list" role="list" aria-label="Functional keys for the collusion exhibit">${offers}</ul>` +
    kv([
      ['keys held', `${held.length}`],
      ['rank over &#8474; / mod &#8467;', `${r.overQ} / ${r.modL}`],
      ['needed for s', `${n}`],
    ]) +
    `<p role="status" aria-live="polite">` +
    (recovery.kind === 'recovered'
      ? verdict('rank-refusal', 'warn', `RANK ${recovery.rank} OF ${n} — s RECOVERED`)
      : recovery.kind === 'rank-deficient'
        ? verdictFor(
            'rank-refusal',
            recovery.rank < n,
            `RANK ${recovery.rank} OF ${n} — RECOVERY REFUSED`,
            'REFUSAL LOGIC IS WRONG',
          )
        : verdict('rank-refusal', 'fail', 'KEY SET IS INCONSISTENT')) +
    `</p>` +
    (recovery.kind === 'rank-deficient' && held.length > 0
      ? `<p class="footnote">` +
        `${held.length} keys held and still rank ${recovery.rank}: a scalar multiple and an ` +
        `exact duplicate each add an equation that was already implied, so neither adds ` +
        `information. The panel shows the rank rather than a recovered s, because printing one ` +
        `of the &#8467;<sup>${n - recovery.rank}</sup> candidate solutions as "the master ` +
        `secret" would be false.` +
        `</p>`
      : '') +
    (recovery.kind === 'recovered'
      ? kv([['s recovered (mod &#8467;)', `<span class="group-el">${recovery.s.join(',<br>')}</span>`]])
      : '') +
    `</div>` +
    proof
  );
}

/* ------------------------------------------------------------------ *
 * 6 — Fixtures
 * ------------------------------------------------------------------ */

export function renderFixtures(): string {
  const rows = CORRECTNESS_FIXTURES.map((f) => {
    const source = seededSource(f.seed);
    const pair = setup(f.n, source);
    const ct = encrypt(pair.mpk, f.x, source);
    const out = decrypt(ct, keyDer(pair.msk, f.y), 2048n);
    const computed = out.dlog.found ? out.dlog.value : null;
    // The row's verdict compares what the SCHEME produced against what the row
    // CLAIMS. It is not a comparison of the scheme with itself.
    const pass = computed !== null && computed === f.claimed;
    return (
      `<tr data-row-state="${pass ? 'pass' : 'fail'}" data-fixture="${escapeHtml(f.id)}">` +
      `<td>${escapeHtml(f.label)}</td>` +
      `<td class="num">${f.n}</td>` +
      `<td class="num">${vec(f.x)}</td>` +
      `<td class="num">${vec(f.y)}</td>` +
      `<td class="num" data-field="computed">${computed === null ? 'no value' : computed}</td>` +
      `<td class="num" data-field="expected">${f.claimed}</td>` +
      `<td>${verdictFor(`fixture-${f.id}`, pass, 'AGREES', 'DISAGREES')}</td>` +
      `</tr>`
    );
  }).join('');

  const wrong = CORRECTNESS_FIXTURES.filter((f) => f.wrongOnPurpose);

  return (
    `<div class="card">` +
    `<span class="step-num">EXHIBIT 6</span>` +
    `<h2>Fixtures, including one that is wrong on purpose</h2>` +
    `<p>` +
    `Each row fixes a seed, so s and r are reproducible, then runs the real Setup, KeyDer, ` +
    `Encrypt and Decrypt and compares the recovered integer against what the row claims. ` +
    `<strong>Both numbers are printed on every row, always</strong> &mdash; a badge that is the ` +
    `only evidence for its own claim cannot be checked by a reader.` +
    `</p>` +
    `<div class="note-box">` +
    `<h3>On the absence of official vectors</h3>` +
    `<p>` +
    `There are no standardized IPFE test vectors, so nothing here is labelled as one. What ` +
    `<em>is</em> pinned to a published source is the layer underneath: the ristretto255 group ` +
    `is checked against all of RFC 9496 Appendix A &mdash; the 16 generator multiples, the 29 ` +
    `encodings that must be rejected, and the 8 one-way-map outputs &mdash; before any scheme ` +
    `code runs on top of it. The FENTEC GoFE and CiFEr implementations of ABDP15 were ` +
    `considered as a cross-check and skipped: they work over a different group, so matching ` +
    `their outputs would mean re-deriving them here, which proves nothing.` +
    `</p>` +
    `</div>` +
    `<div class="table-scroll" tabindex="0" role="region" aria-label="Correctness fixtures">` +
    `<table>` +
    `<caption>The computed value comes from the scheme; the expected value is what the ` +
    `fixture claims.</caption>` +
    `<thead><tr><th>fixture</th><th class="num">n</th><th class="num">x</th>` +
    `<th class="num">y</th><th class="num">computed</th><th class="num">claimed</th>` +
    `<th>verdict</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    `<div class="alarm-box">` +
    `<h3>Why one row disagrees</h3>` +
    `<p>` +
    `The last row claims 16 where its own x and y give 15. It is not a bug and it is not to be ` +
    `fixed. A table that has only ever been seen agreeing is not evidence about anything: if ` +
    `every row passes, a change that forces the comparison always-true looks identical from ` +
    `here. The disagreeing row is what shows the comparison is live.` +
    `</p>` +
    `<p>` +
    verdictFor(
      'wrong-fixture-detected',
      wrong.length === 1 &&
        wrong.every((f) => {
          const source = seededSource(f.seed);
          const pair = setup(f.n, source);
          const ct = encrypt(pair.mpk, f.x, source);
          const out = decrypt(ct, keyDer(pair.msk, f.y), 2048n);
          return out.dlog.found && out.dlog.value !== f.claimed;
        }),
      'THE DELIBERATELY WRONG ROW IS REPORTED AS DISAGREEING',
      'THE WRONG ROW WAS NOT CAUGHT',
    ) +
    `</p>` +
    `</div>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ *
 * 7 — Where IPFE sits
 * ------------------------------------------------------------------ */

export function renderCompare(): string {
  return (
    `<div class="card">` +
    `<span class="step-num">EXHIBIT 7</span>` +
    `<h2>Three different questions, three different tools</h2>` +
    `<p>` +
    `These get conflated constantly, and the distinction is not about strength. Each controls a ` +
    `different thing.` +
    `</p>` +
    `<div class="compare-grid">` +
    `<div>` +
    `<span class="tag">ABE</span>` +
    `<h3>Controls <em>whether</em> the plaintext is released</h3>` +
    `<p>` +
    `A policy decides who may decrypt. Satisfy it and you get the whole message; fail it and ` +
    `you get nothing. The granularity is in the access decision, not in the output.` +
    `</p>` +
    `<p class="footnote">` +
    `Built in the fleet, not absent from it: ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-attribute-gate/" target="_blank" rel="noopener noreferrer">Attribute Gate</a> ` +
    `implements FAME CP-ABE over BLS12-381 and leads on collusion resistance &mdash; two real ` +
    `keys spliced together, and the term that refuses to cancel.` +
    `</p>` +
    `</div>` +
    `<div>` +
    `<span class="tag">IPFE · THIS LAB</span>` +
    `<h3>Controls <em>which function</em> of the plaintext is released</h3>` +
    `<p>` +
    `Everyone authorized gets an answer; the key decides which answer. Here that function is ` +
    `a weighted sum, and the key holder learns the sum without learning the terms.` +
    `</p>` +
    `<p class="footnote">` +
    `The comparison worth drawing against ABE: collusion in ABE is about combining attributes ` +
    `to satisfy a policy neither key satisfies alone, and FAME resists it. Collusion here is a ` +
    `different thing entirely &mdash; the keys combine <em>linearly</em>, exactly as ` +
    `authorized, and what they add up to is the plaintext. Nothing is being resisted because ` +
    `nothing is being broken.` +
    `</p>` +
    `</div>` +
    `<div>` +
    `<span class="tag">FHE</span>` +
    `<h3>Lets a server compute <em>without learning</em> the plaintext</h3>` +
    `<p>` +
    `The party doing the work stays blind; the key holder learns the result. FE and FHE point ` +
    `in opposite directions &mdash; FE reveals a function's output to a key holder, FHE hides ` +
    `everything from the computer and returns a ciphertext.` +
    `</p>` +
    `<p class="footnote">` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-fhe-arena/" target="_blank" rel="noopener noreferrer">FHE Arena</a>, ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-ckks-lab/" target="_blank" rel="noopener noreferrer">CKKS Lab</a> and ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-blind-oracle/" target="_blank" rel="noopener noreferrer">Blind Oracle</a> ` +
    `cover this axis.` +
    `</p>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `<div class="note-box">` +
    `<h3>Assumed, not taught here</h3>` +
    `<p>` +
    `This lab does not reteach DDH or ElGamal. The short version: the security of the ` +
    `ciphertext above rests on being unable to tell <code>g<sup>ab</sup></code> from a random ` +
    `group element given <code>g<sup>a</sup></code> and <code>g<sup>b</sup></code>. If that is ` +
    `new, start with ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-elgamal-plain/" target="_blank" rel="noopener noreferrer">ElGamal Plain</a> ` +
    `or ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-curve-lens/" target="_blank" rel="noopener noreferrer">Curve Lens</a> ` +
    `and come back.` +
    `</p>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ *
 * 8 — Honesty panel, including the negative claim
 * ------------------------------------------------------------------ */

export function renderHonesty(state: LabState): string {
  // The negative-claim fixture, computed live: a mauled ciphertext that every
  // check accepts.
  const source = seededSource('function-key/malleable');
  const pair = setup(4, source);
  const x = [2n, 1n, 3n, 0n];
  const xp = [1n, 4n, -2n, 5n];
  const y = [3n, 1n, 2n, 1n];
  const key = keyDer(pair.msk, y);
  const ctA = encrypt(pair.mpk, x, source);
  const ctB = encrypt(pair.mpk, xp, source);
  const mauled = combineCiphertexts(ctA, ctB);
  const out = decrypt(mauled, key, DEFAULT_BOUND);
  const sum = x.map((v, i) => v + xp[i]);
  const expectedSum = dot(sum, y);
  const got = out.dlog.found ? out.dlog.value : null;
  const originalAnswer = dot(x, y);

  // Assertion-2 shape: every check the page performs in this state succeeds.
  const decryptSucceeded = got !== null;
  const answerIsCorrect = got !== null && got === expectedSum;
  const answerIsNotTheOriginal = got !== null && got !== originalAnswer;

  return (
    `<div class="card">` +
    `<span class="step-num">EXHIBIT 8</span>` +
    `<h2>What is real, what is modeled, what is not here</h2>` +
    `<div class="honesty-cols">` +
    `<div>` +
    `<h3>Real</h3>` +
    `<ul>` +
    `<li>ristretto255 group operations via <code>@noble/curves</code>, pinned to all of RFC 9496 Appendix A</li>` +
    `<li>ABDP15 Construction 3.1 &mdash; Setup, KeyDer, Encrypt, Decrypt &mdash; implemented here</li>` +
    `<li>Baby-step giant-step with an exact group-operation counter</li>` +
    `<li>Reconstruction and master-secret recovery, in exact rational and mod-&#8467; arithmetic</li>` +
    `</ul>` +
    `</div>` +
    `<div>` +
    `<h3>Modeled</h3>` +
    `<ul>` +
    `<li>The authority and analyst roles are panels on one page; there is no key-distribution protocol</li>` +
    `<li>Key material is per-session and in memory; nothing is persisted</li>` +
    `<li>Wall-clock timings are machine-dependent and labelled as such &mdash; operation counts are not</li>` +
    `</ul>` +
    `</div>` +
    `<div>` +
    `<h3>Not implemented</h3>` +
    `<ul>` +
    `<li>Adaptive security. ABDP15 Theorem 3.2 proves <em>selective</em> IND-FE-CPA; ALS16 gets adaptive security and is not built here</li>` +
    `<li>The Paillier variant that removes the small-output bound</li>` +
    `<li>General-function FE, function-hiding, multi-input and multi-client IPFE</li>` +
    `<li>Any CCA security whatever &mdash; see the negative claim below</li>` +
    `</ul>` +
    `</div>` +
    `</div>` +
    `<h3>Threat model</h3>` +
    `<ul>` +
    `<li>The authority is trusted to generate keys honestly.</li>` +
    `<li>Key holders may collude, and exhibits 4 and 5 show exactly what collusion yields &mdash; which is everything, once the keys are independent enough.</li>` +
    `<li>Security is selective IND-FE-CPA under DDH (ABDP15 Theorem 3.2). Adaptive security needs ALS16.</li>` +
    `<li>No CCA security, and no integrity of any kind.</li>` +
    `</ul>` +
    `<p class="footnote">Not production cryptography. This is a teaching demo.</p>` +
    `</div>` +

    `<div class="alarm-box">` +
    `<h3>Negative claim &mdash; and the state that proves it</h3>` +
    `<p data-field="negative-claim">` +
    `<strong>ABDP15 ciphertexts are additively malleable: this scheme gives no integrity, so ` +
    `anyone can turn a ciphertext of x into a valid ciphertext of x + x&#39; without any key, ` +
    `and decryption cannot tell.</strong>` +
    `</p>` +
    `<p>` +
    `Below, two ciphertexts are multiplied componentwise by a party holding no key at all. The ` +
    `product is a well-formed encryption of the sum under randomness r + r&#39;, so every check ` +
    `the scheme performs succeeds and the functional key returns a correct answer &mdash; to a ` +
    `question nobody asked.` +
    `</p>` +
    `<div class="table-scroll" tabindex="0" role="region" aria-label="Malleability exhibit">` +
    `<table><thead><tr><th>step</th><th class="num">value</th><th>verdict</th></tr></thead>` +
    `<tbody>` +
    `<tr><td>&lt;x, y&gt; &mdash; the answer the authority expected</td>` +
    `<td class="num">${originalAnswer}</td><td>&mdash;</td></tr>` +
    `<tr><td>ct(x) &#8857; ct(x&#39;) decrypts to</td>` +
    `<td class="num" data-field="computed">${got === null ? 'no value' : got}</td>` +
    `<td>${verdictFor('maul-decrypts', decryptSucceeded, 'DECRYPTION SUCCEEDED', 'DECRYPTION FAILED')}</td></tr>` +
    `<tr><td>&lt;x + x&#39;, y&#39;&gt; &mdash; expected for the mauled ciphertext</td>` +
    `<td class="num" data-field="expected">${expectedSum}</td>` +
    `<td>${verdictFor('maul-correct', answerIsCorrect, 'ANSWER IS ARITHMETICALLY CORRECT', 'ANSWER IS WRONG')}</td></tr>` +
    `<tr><td>Did any check report tampering?</td><td class="num">no</td>` +
    `<td>${verdictFor('maul-undetected', answerIsNotTheOriginal, 'NO FAILURE CODE EXISTS TO RAISE', 'THE PLAINTEXT WAS UNCHANGED')}</td></tr>` +
    `</tbody></table></div>` +
    `<p>` +
    verdict(
      'negative-claim-verdict',
      'warn',
      answerIsCorrect && answerIsNotTheOriginal
        ? 'DECRYPTED — AND MODIFIED'
        : 'FIXTURE DID NOT REACH THE MALLEABLE STATE',
    ) +
    `</p>` +
    `<p class="footnote">` +
    `The absence of a failure code is the exhibit. ABDP15 claims CPA security and nothing more, ` +
    `so there is no integrity check here to fail, and inventing one to look thorough would ` +
    `teach the opposite of the lesson. If you need ciphertexts that resist this, you need a ` +
    `different construction, not a stricter parser.` +
    `</p>` +
    `</div>` +

    `<div class="card">` +
    `<h3>Primary sources</h3>` +
    `<ul>` +
    `<li>M. Abdalla, F. Bourse, A. De Caro, D. Pointcheval, <em>Simple Functional Encryption ` +
    `Schemes for Inner Products</em>, PKC 2015; ` +
    `<a href="https://eprint.iacr.org/2015/017" target="_blank" rel="noopener noreferrer">ePrint 2015/017</a> ` +
    `&mdash; Construction 3.1 and Theorem 3.2, the scheme built here.</li>` +
    `<li>S. Agrawal, B. Libert, D. Stehl&eacute;, <em>Fully Secure Functional Encryption for ` +
    `Inner Products, from Standard Assumptions</em>, CRYPTO 2016; ` +
    `<a href="https://eprint.iacr.org/2015/608" target="_blank" rel="noopener noreferrer">ePrint 2015/608</a> ` +
    `&mdash; adaptive security. It attributes removing the small-interval restriction to ` +
    `Paillier specifically; its LWE schemes keep short coordinates and add inner products ` +
    `modulo a prime instead.</li>` +
    `<li>D. Boneh, A. Sahai, B. Waters, <em>Functional Encryption: Definitions and Challenges</em>, ` +
    `TCC 2011, LNCS 6597, pp. 253&ndash;273; ` +
    `<a href="https://eprint.iacr.org/2010/543" target="_blank" rel="noopener noreferrer">ePrint 2010/543</a> ` +
    `&mdash; the definitions. Note the ePrint year (2010) differs from the conference year.</li>` +
    `<li><a href="https://www.rfc-editor.org/rfc/rfc9496.html" target="_blank" rel="noopener noreferrer">RFC 9496</a>, ` +
    `<em>The ristretto255 and decaf448 Groups</em>, IRTF/CFRG, December 2023 &mdash; the group, ` +
    `and the Appendix A vectors this lab pins the library against.</li>` +
    `</ul>` +
    `<p class="footnote">` +
    `Notation: ABDP15 writes the vector dimension as &#8467; and the group order as p. This lab ` +
    `follows RFC 9496 and writes the group order as &#8467;, calling the dimension n. Read our n ` +
    `where the paper says &#8467;. Current settings: n = ${state.n}, B = ${state.bound}, ` +
    `&#8467; = 2<sup>252</sup> + 27742317777372353535851937790883648493.` +
    `</p>` +
    `<p class="footnote">Group order in full: <code>${GROUP_ORDER}</code></p>` +
    `</div>`
  );
}

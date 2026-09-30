/**
 * The four teaching stages, plus the evidence area.
 *
 * The previous shape was eight peer tabs that gave the main lesson, the
 * fixtures, the comparison material and the audit trail equal weight, and
 * ended each panel with no next action. The rigor is unchanged; what changed
 * is the hierarchy. Four stages carry the argument in order, and everything
 * that exists to be checked rather than read moved to `Evidence`.
 *
 * Progressive disclosure rule used throughout: one dominant result and one
 * short explanation stay visible per stage; raw group encodings, canonical
 * scalar checks, derivations and full tables go under a `Verify this` or
 * `Under the hood` disclosure. The negative security claim itself stays
 * visible, as section 4.1d requires — only its derivation is disclosed.
 */

import {
  combineCiphertexts,
  decryptToElement,
  decrypt,
  encrypt,
  keyDer,
  recoverFullVector,
  setup,
} from '../crypto/ipfe';
import { seededSource, systemSource } from '../crypto/prng';
import { GROUP_ORDER, toHex } from '../crypto/ristretto';
import { MAX_BOUND, tableSizeFor, worstCaseOps } from '../crypto/dlog';
import { fToString, rationalRank } from '../crypto/linalg';
import {
  WHY_PERMITTED,
  forgeKey,
  isConsistent,
  knowledgeFrom,
  ranks,
  recoverMasterSecret,
  sampleCandidates,
  type Observation,
} from '../crypto/attacks';
import {
  CORRECTNESS_FIXTURES,
  DEFAULT_BOUND,
  NEVER_ISSUED_Y,
  PARTIAL_KNOWLEDGE,
  RANK_DEFICIENT_YS,
} from '../crypto/fixtures';
import { ENTRY_MAX } from '../crypto/types';
import type { FunctionalKey } from '../crypto/types';
import { costChart, costTable, type CostPoint } from './chart';
import { analyseRows, renderMatrix } from './matrix';
import { escapeHtml, kv, vec, verdict, verdictFor } from './dom';
import { currentAnswer, type LabState } from './state';

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/** The independent integer dot product, computed in the UI from x and y. */
function dot(x: readonly bigint[], y: readonly bigint[]): bigint {
  let acc = 0n;
  for (let i = 0; i < x.length; i++) acc += x[i] * y[i];
  return acc;
}

/**
 * The bound used when reading ONE coordinate.
 *
 * A coordinate is a single entry, so its range is the entry range — not the
 * inner-product range, which has to hold a sum of n products. Using the
 * smaller bound here is not a shortcut: it is the correct bound for the
 * question being asked, and it keeps the authority's n searches cheap enough
 * to run inline while the analyst's single search is the one that gets the
 * worker and the staged reveal.
 */
const COORD_BOUND = BigInt(ENTRY_MAX);

function details(summary: string, body: string, open = false): string {
  return (
    `<details class="disclose"${open ? ' open' : ''}>` +
    `<summary>${escapeHtml(summary)}</summary>` +
    `<div class="disclose-body">${body}</div>` +
    `</details>`
  );
}

/* ------------------------------------------------------------------ *
 * Stage 1 — Ask one question
 * ------------------------------------------------------------------ */

export function renderAsk(state: LabState): string {
  const { msk } = state.keys;
  const key = keyDer(msk, state.y);
  const expected = currentAnswer(state);

  // THE AUTHORITY'S SIDE IS NOW EXECUTED, not echoed. ABDP15 defines no
  // separate full decryption, so the whole vector is read the only way the
  // scheme allows: one functional key per basis vector.
  const coords = recoverFullVector(msk, state.ciphertext, COORD_BOUND);
  const recovered = coords.map((c) => (c.dlog.found ? c.dlog.value : null));
  const allFound = recovered.every((v) => v !== null);
  const matchesInput = allFound && recovered.every((v, i) => v === state.x[i]);

  const analyst = decrypt(state.ciphertext, key, state.bound);
  const got = analyst.dlog.found ? analyst.dlog.value : null;

  return (
    `<div class="stage-head">` +
    `<span class="step-num">STAGE 1 OF 4</span>` +
    `<h2>One key, one authorized answer</h2>` +
    `<p class="lede">` +
    `Both columns below read the <em>same</em> ciphertext. The difference is not how much power ` +
    `each side has — it is how many questions each one is authorized to ask.` +
    `</p>` +
    `</div>` +
    `<div class="compare-grid">` +
    `<div class="col-authority">` +
    `<span class="tag">AUTHORITY &middot; holds s</span>` +
    `<h3>Reads every coordinate</h3>` +
    `<p>` +
    `Derives a key for each basis vector e<sub>i</sub> and decrypts with it. Since ` +
    `&lt;x, e<sub>i</sub>&gt; = x<sub>i</sub>, that is n answers, one per coordinate.` +
    `</p>` +
    `<p class="recovered-vec" data-field="authority-vector">` +
    (allFound
      ? `(${recovered.map((v) => String(v)).join(', ')})`
      : `<span class="pending-int">a coordinate fell outside the range</span>`) +
    `</p>` +
    `<p>` +
    verdictFor(
      'authority-recovery',
      matchesInput,
      'RECOVERED FROM THE CIPHERTEXT, COORDINATE BY COORDINATE',
      'RECOVERY DOES NOT MATCH THE ENCRYPTED VECTOR',
    ) +
    `</p>` +
    `<p class="footnote">` +
    `Nothing here reads the vector you typed. Each number above came out of a real decryption ` +
    `of this ciphertext under a real functional key — which is exactly why this column and ` +
    `stage 3 are the same mechanism run by different people.` +
    `</p>` +
    `</div>` +
    `<div class="col-analyst">` +
    `<span class="tag">ANALYST &middot; holds sk<sub>y</sub></span>` +
    `<h3>Reads one weighted sum</h3>` +
    `<p>Holds one scalar. It answers for y and for nothing else.</p>` +
    `<p>` +
    (got === null
      ? `<span class="pending-int">no value &mdash; outside the bound</span>`
      : `<span class="recovered-int" data-field="analyst-answer">${got}</span>`) +
    `</p>` +
    `<p>` +
    verdictFor(
      'correctness',
      got !== null && got === expected,
      'MATCHES THE WEIGHTED SUM',
      got === null ? 'NO VALUE IN RANGE' : 'DOES NOT MATCH',
    ) +
    `</p>` +
    `<p class="footnote">` +
    `from the scheme: <code data-field="computed">${got === null ? 'no value' : got}</code> &middot; ` +
    `from x and y directly: <code data-field="expected">${expected}</code>` +
    `</p>` +
    `</div>` +
    `</div>` +
    `<p class="takeaway">` +
    `A functional key reveals nothing beyond what its authorized answer logically implies. That ` +
    `is a weaker promise than "nothing else", and the difference is the whole lab: a key for ` +
    `e<sub>1</sub> is a perfectly ordinary functional key, and its authorized answer <em>is</em> ` +
    `a coordinate of x.` +
    `</p>` +
    details(
      'Under the hood — the key itself',
      kv([
        ['sk<sub>y</sub> = &lt;s, y&gt; mod &#8467;', `<span class="group-el" data-field="sk">${key.sk}</span>`],
        ['mpk h<sub>1</sub> = g<sup>s<sub>1</sub></sup>', `<span class="group-el">${toHex(state.keys.mpk.h[0])}</span>`],
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
        `Entries of x and y are <strong>integers</strong> and can be negative; keys are ` +
        `<strong>scalars mod &#8467;</strong>. The raw inner product &lt;s, y&gt; may be ` +
        `negative or larger than &#8467; before reduction, so the reduction is asserted rather ` +
        `than assumed. &#8467; = <code>${GROUP_ORDER}</code>.` +
        `</p>`,
    )
  );
}

/* ------------------------------------------------------------------ *
 * Stage 2 — Decode the bounded answer
 * ------------------------------------------------------------------ */

export function renderDecode(state: LabState, degraded: boolean): string {
  const key = keyDer(state.keys.msk, state.y);
  const expected = currentAnswer(state);
  const element = decryptToElement(state.ciphertext, key);

  const phase = state.decode;
  const res = state.decodeResult;
  const showResult = phase === 'done' && res !== null && res.generation === state.generation;

  // The ciphertext comparison, which is where invariant 2 is visible: the
  // components change under a fresh r, and the element below them does not.
  const prev = state.previous;
  const ct0Now = toHex(state.ciphertext.ct0);
  const ct0Before = prev && prev.n === state.ciphertext.n ? toHex(prev.ct0) : null;
  const allChanged =
    prev !== null &&
    prev.n === state.ciphertext.n &&
    ct0Before !== ct0Now &&
    state.ciphertext.ct.every((c, i) => toHex(c) !== toHex(prev.ct[i]));

  const componentRows =
    `<tr><th scope="row" class="num">ct<sub>0</sub></th>` +
    `<td><span class="group-el" data-field="ct0-now">${ct0Now}</span></td>` +
    (ct0Before === null
      ? `<td class="num">&mdash;</td>`
      : `<td>${verdictFor('component-ct0', ct0Before !== ct0Now, 'CHANGED', 'IDENTICAL')}</td>`) +
    `</tr>` +
    state.ciphertext.ct
      .map((c, i) => {
        const now = toHex(c);
        const before = prev && prev.n === state.ciphertext.n ? toHex(prev.ct[i]) : null;
        return (
          `<tr><th scope="row" class="num">ct<sub>${i + 1}</sub></th>` +
          `<td><span class="group-el" data-field="ct-now-${i}">${now}</span></td>` +
          (before === null
            ? `<td class="num">&mdash;</td>`
            : `<td>${verdictFor(`component-${i}`, before !== now, 'CHANGED', 'IDENTICAL')}</td>`) +
          `</tr>`
        );
      })
      .join('');

  const stepTwo =
    phase === 'idle'
      ? `<p class="staged-empty" data-field="decode-idle">` +
        `Nothing has been applied yet. Press the button above.` +
        `</p>`
      : `<p class="footnote">` +
        `&prod;<sub>i</sub> ct<sub>i</sub><sup>y<sub>i</sub></sup> &divide; ` +
        `ct<sub>0</sub><sup>sk<sub>y</sub></sup>, exactly as ABDP15 Construction 3.1 writes it. ` +
        `The r terms cancel; the inner product survives, in the exponent.` +
        `</p>` +
        `<span class="group-el group-el-hero" data-field="element">${toHex(element)}</span>` +
        `<p>${verdict('decrypt-applied', 'ok', 'DECRYPTION IS COMPLETE')}</p>` +
        `<p class="footnote">` +
        `That is the whole output of the scheme. There is no further arithmetic to do on the ` +
        `ciphertext &mdash; and no number on screen.` +
        `</p>`;

  const stepThree =
    phase === 'idle'
      ? ''
      : phase === 'applied'
        ? `<div class="staged-step">` +
          `<p class="arrow-down" aria-hidden="true">&darr;</p>` +
          `<h3>Step 2 &mdash; search for the exponent</h3>` +
          `<p>` +
          `Recovering the integer means solving a discrete log over ` +
          `[&minus;${state.bound}, ${state.bound}]. It is a search, and it has a price.` +
          `</p>` +
          `<button class="btn btn-primary" id="btn-recover" type="button">` +
          `Recover the integer</button>` +
          `<p class="staged-empty" data-field="no-integer-yet">` +
          verdict('search-staged', 'info', 'NO INTEGER EXISTS ANYWHERE ON THIS PAGE YET') +
          `</p>` +
          `</div>`
        : phase === 'searching'
          ? `<div class="staged-step">` +
            `<p class="arrow-down" aria-hidden="true">&darr;</p>` +
            `<h3>Step 2 &mdash; searching</h3>` +
            `<p role="status" aria-live="polite" data-field="search-status">` +
            verdict('search-staged', 'warn', 'SEARCHING — NO INTEGER YET') +
            `</p>` +
            `<p class="footnote">` +
            `Walking up to ${tableSizeFor(state.bound)} baby steps and ` +
            `${worstCaseOps(state.bound).giantSteps} giant steps` +
            (degraded ? ' on the main thread (no worker available).' : ' in a worker.') +
            `</p>` +
            `</div>`
          : `<div class="staged-step">` +
            `<p class="arrow-down" aria-hidden="true">&darr;</p>` +
            `<h3>Step 2 &mdash; the exponent</h3>` +
            (showResult && res && res.found && res.value !== null
              ? `<p><span class="recovered-int" data-field="recovered">${res.value}</span></p>` +
                `<p role="status" aria-live="polite">` +
                verdictFor(
                  'decrypt-exact',
                  res.value === expected,
                  'EXPONENT RECOVERED EXACTLY',
                  'RECOVERED VALUE IS WRONG',
                ) +
                `</p>` +
                `<p class="footnote">` +
                `recovered: <code data-field="computed">${res.value}</code> &middot; ` +
                `expected: <code data-field="expected">${expected}</code> &middot; ` +
                `<code data-field="search-ops">${res.ops.total}</code> group operations &middot; ` +
                `<code>${res.elapsedMs.toFixed(0)} ms</code> (machine-dependent)` +
                `</p>`
              : `<p><span class="pending-int">no value &mdash; not found in range</span></p>` +
                `<p role="status" aria-live="polite">` +
                verdict('range-search', 'warn', 'SEARCH EXHAUSTED, NO VALUE RETURNED') +
                `</p>` +
                `<p class="footnote">` +
                `The honest failure, not a wrapped answer. The true inner product is ` +
                `<code data-field="expected">${expected}</code>, outside ` +
                `[&minus;${state.bound}, ${state.bound}]. Widen B in the bar above.` +
                `</p>` +
                `<p class="footnote">` +
                `<code data-field="search-ops">${res?.ops.total ?? 0}</code> group operations ` +
                `spent proving there is nothing there.` +
                `</p>`) +
            `<button class="btn" id="btn-redo-search" type="button">Run it again</button>` +
            `</div>`;

  return (
    `<div class="stage-head">` +
    `<span class="step-num">STAGE 2 OF 4</span>` +
    `<h2>Decryption finishes before the answer arrives</h2>` +
    `<p class="lede">` +
    `This is the part that surprises people, so it is split into two presses rather than ` +
    `described. Applying the key succeeds immediately. The integer is a separate search, and ` +
    `until you run it there is no integer anywhere on this page.` +
    `</p>` +
    `</div>` +
    `<div class="card staged">` +
    `<h3>Step 1 &mdash; apply the functional key</h3>` +
    (phase === 'idle'
      ? `<button class="btn btn-primary" id="btn-apply" type="button">Apply functional key</button>`
      : `<button class="btn" id="btn-restart-decode" type="button">Start over</button>`) +
    stepTwo +
    stepThree +
    `</div>` +
    (degraded
      ? `<div class="alarm-box"><h3>Running without a worker</h3>` +
        `<p>This browser did not give the page a Web Worker, so the search runs on the main ` +
        `thread and a large bound will freeze the interface. The timing demonstration is still ` +
        `honest; it is just not isolated.</p></div>`
      : '') +
    renderCost(state) +
    details(
      'Verify this — the ciphertext under a fresh r',
      `<p>` +
      `A fresh r changes every component of the ciphertext. It does not change the element ` +
      `above, because the r terms cancel &mdash; the randomness hides the ciphertext, and was ` +
      `never meant to hide the answer.` +
      `</p>` +
      `<div class="table-scroll" tabindex="0" role="region" ` +
      `aria-label="Ciphertext components, compared against the previous encryption">` +
      `<table><caption>` +
      (prev === null
        ? 'Press "Encrypt again" in the bar above to compare against a previous ciphertext.'
        : 'Compared componentwise against the ciphertext this one replaced.') +
      `</caption><thead><tr><th scope="col" class="num">component</th>` +
      `<th scope="col">value now</th><th scope="col">vs previous</th></tr></thead>` +
      `<tbody>${componentRows}</tbody></table></div>` +
      `<p>` +
      (prev === null
        ? verdict('randomized', 'info', 'NO PREVIOUS CIPHERTEXT TO COMPARE YET')
        : verdictFor(
            'randomized',
            allChanged,
            'EVERY COMPONENT CHANGED UNDER A FRESH r',
            'SOME COMPONENT REPEATED',
          )) +
      `</p>`,
    ) +
    renderBoundary()
  );
}

function renderCost(state: LabState): string {
  if (state.costPending || state.cost === null) {
    return (
      `<div class="card">` +
      `<h3>What the search costs</h3>` +
      `<p role="status" aria-live="polite" data-field="cost-status">` +
      verdict('cost-law', 'info', 'MEASURING — RUNNING ONE FULL SEARCH PER WIDTH') +
      `</p>` +
      `<p class="footnote">` +
      `Every point on the chart is a search that ran to completion against a target outside its ` +
      `range, so the number plotted is a counter a search returned rather than a formula.` +
      `</p>` +
      `</div>`
    );
  }

  const points: CostPoint[] = state.cost.map((p) => ({
    bound: BigInt(p.bound),
    width: BigInt(p.width),
    measuredOps: p.measuredOps,
    predictedOps: p.predictedOps,
    reference: 2 * Math.sqrt(Number(p.width)),
    elapsedMs: p.elapsedMs,
  }));

  const ratios = points.map((p) => p.measuredOps / Math.sqrt(Number(p.width)));
  const minR = Math.min(...ratios);
  const maxR = Math.max(...ratios);
  const spread = maxR / minR;
  const TOLERANCE = 1.2;
  const allAgree = points.every((p) => p.measuredOps === p.predictedOps);

  return (
    `<div class="card">` +
    `<h3>What the search costs</h3>` +
    `<p>` +
    `Baby-step giant-step trades memory for time and turns a search of width W into about ` +
    `2&#8730;W operations. That is the only reason a bound in the millions is reachable in a ` +
    `browser &mdash; and it is still a search, which is the limit ABDP15 is honest about.` +
    `</p>` +
    costChart(
      points,
      state.bound,
      'Group operations charged by completed searches, against search width, on logarithmic ' +
        'axes, with the reference curve two times the square root of W and a marker for the ' +
        'bound currently selected.',
    ) +
    `<p>` +
    verdictFor(
      'cost-law',
      spread < TOLERANCE,
      `SQUARE-ROOT SCALING HOLDS ACROSS ${points.length} MEASURED WIDTHS`,
      'SCALING IS NOT SQUARE-ROOT',
    ) +
    ` ` +
    verdictFor(
      'cost-measured-agrees',
      allAgree,
      'EVERY MEASURED COUNT MATCHES THE CLOSED FORM',
      'A MEASURED COUNT DISAGREES WITH THE CLOSED FORM',
    ) +
    `</p>` +
    `<p class="footnote">` +
    `ops &divide; &#8730;W ranges over <code data-field="ratio-min">${minR.toFixed(3)}</code> to ` +
    `<code data-field="ratio-max">${maxR.toFixed(3)}</code>; spread ` +
    `<code data-field="ratio-spread">${spread.toFixed(3)}</code>, tolerance ` +
    `<code data-field="ratio-tolerance">${TOLERANCE}</code>. Quadruple the width and the cost ` +
    `doubles; a linear cost would quadruple it.` +
    `</p>` +
    details('Verify this — every measured run', costTable(points, state.bound)) +
    `</div>`
  );
}

function renderBoundary(): string {
  // A fixed n = 2 scenario with a product of exactly 25, so the boundary sits
  // at a known place and does not move when the reader edits the vectors.
  const src = seededSource('edge-demo');
  const pair = setup(2, src);
  const key = keyDer(pair.msk, [5n, 0n]);
  const ctPos = encrypt(pair.mpk, [5n, 0n], src);
  const ctNeg = encrypt(pair.mpk, [-5n, 0n], src);
  const atBound = decrypt(ctPos, key, 25n);
  const overBound = decrypt(ctPos, key, 24n);
  const negAtBound = decrypt(ctNeg, key, 25n);
  const negOverBound = decrypt(ctNeg, key, 24n);

  const rows: readonly [string, boolean, string, string][] = [
    ['+25 with B = 25 (inside)', atBound.dlog.found, atBound.dlog.found ? String(atBound.dlog.value) : 'no value', '25'],
    ['+25 with B = 24 (outside)', !overBound.dlog.found, overBound.dlog.found ? String(overBound.dlog.value) : 'no value', 'no value'],
    ['&minus;25 with B = 25 (inside)', negAtBound.dlog.found, negAtBound.dlog.found ? String(negAtBound.dlog.value) : 'no value', '-25'],
    ['&minus;25 with B = 24 (outside)', !negOverBound.dlog.found, negOverBound.dlog.found ? String(negOverBound.dlog.value) : 'no value', 'no value'],
  ];
  const allCorrect = rows.every(([, ok]) => ok);
  const negWorks = negAtBound.dlog.found && negAtBound.dlog.value === -25n;

  return details(
    'Verify this — the edge of the range, in both directions',
    `<p>` +
    `A fixed scenario (n = 2, product exactly 25) so the boundary stays put. Both signs are ` +
    `shown because the range is symmetric: a search covering only [0, B] would pass every ` +
    `positive case while silently losing every negative one.` +
    `</p>` +
    `<div class="table-scroll" tabindex="0" role="region" ` +
    `aria-label="Boundary behaviour of the bounded search">` +
    `<table><caption>Both the returned and the expected result on every row, always.</caption>` +
    `<thead><tr><th scope="col">case</th><th scope="col" class="num">returned</th>` +
    `<th scope="col" class="num">expected</th><th scope="col">verdict</th></tr></thead><tbody>` +
    rows
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
      allCorrect && negWorks,
      'SYMMETRIC RANGE: BOTH SIGNS INSIDE, BOTH REFUSED OUTSIDE',
      'RANGE BEHAVIOUR IS WRONG',
    ) +
    `</p>`,
  );
}

/* ------------------------------------------------------------------ *
 * Stage 3 — Watch knowledge accumulate
 * ------------------------------------------------------------------ */

/** The y vectors stage 3 offers, in order. */
export const STAGE3_OFFERS: readonly (readonly bigint[])[] = [
  PARTIAL_KNOWLEDGE.keys[0].y,
  PARTIAL_KNOWLEDGE.keys[1].y,
  [1n, 0n, 0n, 0n],
  [0n, 0n, 1n, 0n],
];

function stage3Observations(taken: readonly number[]): {
  observations: Observation[];
  n: number;
} {
  const { n, xA, seed } = PARTIAL_KNOWLEDGE;
  const src = seededSource(seed);
  const pair = setup(n, src);
  const ct = encrypt(pair.mpk, xA, src);
  const observations: Observation[] = [];
  for (const i of taken) {
    const y = STAGE3_OFFERS[i];
    const r = decrypt(ct, keyDer(pair.msk, y), DEFAULT_BOUND);
    if (r.dlog.found) observations.push({ y, output: r.dlog.value });
  }
  return { observations, n };
}

export function renderAccumulate(state: LabState): string {
  const { observations, n } = stage3Observations(state.collected);
  const know = knowledgeFrom(observations, n);
  const pair = sampleCandidates(know);

  const rows = analyseRows(
    observations.map((o) => o.y),
    observations.map((o) => String(o.output)),
    n,
  );

  const offers = STAGE3_OFFERS.map((y, i) => {
    const taken = state.collected.includes(i);
    if (taken) {
      return (
        `<li><code>y = ${vec(y)}</code> ` +
        `<span class="verdict verdict-info" data-verdict="offer-${i}">` +
        `<i class="verdict-icon" aria-hidden="true">i</i><span>ISSUED</span></span></li>`
      );
    }
    // What this key WOULD buy, shown before it is issued.
    const wouldBe = rationalRank([...observations.map((o) => o.y), y], n);
    const gains = wouldBe > know.rank;
    return (
      `<li><code>y = ${vec(y)}</code> ` +
      `<button class="btn" type="button" data-request-key="${i}" ` +
      `aria-label="Request a functional key for y equals ${y.join(', ')}">Request key</button> ` +
      `<span class="offer-note">${gains ? `rank ${know.rank} &rarr; ${wouldBe}` : 'adds nothing new'}</span>` +
      `</li>`
    );
  }).join('');

  const candidateBlock = know.pinned
    ? `<div class="card revealed">` +
      `<h3>The family collapses to one point</h3>` +
      `<p>` +
      `At full rank there is exactly one vector consistent with every answer received. It can ` +
      `now be named, because nothing else is possible.` +
      `</p>` +
      `<p class="recovered-vec" data-field="reconstructed">` +
      `(${(know.recovered ?? []).map(fToString).join(', ')})</p>` +
      `<p>` +
      verdictFor(
        'reconstruct',
        know.pinned &&
          (know.recovered ?? []).every((f, i) => f.den === 1n && f.num === PARTIAL_KNOWLEDGE.xA[i]),
        'x RECOVERED EXACTLY, AND IT IS THE ENCRYPTED VECTOR',
        'RECONSTRUCTION DOES NOT MATCH THE ENCRYPTED VECTOR',
      ) +
      `</p>` +
      `<p class="footnote">` +
      `Rational Gaussian elimination over BigInt fractions; every coordinate landed on an ` +
      `integer with denominator 1, so "exact" is a property of the arithmetic rather than a ` +
      `description of the output. recovered ` +
      `<code data-field="computed">${(know.recovered ?? []).map(fToString).join(', ')}</code> ` +
      `&middot; encrypted <code data-field="expected">${PARTIAL_KNOWLEDGE.xA.join(', ')}</code>` +
      `</p>` +
      `</div>`
    : pair
      ? `<div class="card">` +
        `<h3>Two of the vectors still possible</h3>` +
        `<p>` +
        `Both of these produce <em>every</em> answer received so far. Neither is marked as the ` +
        `real one, because at this point nothing on the page knows which it is &mdash; that is ` +
        `the claim.` +
        `</p>` +
        `<div class="cand-pair">` +
        `<div><span class="tag">CANDIDATE A</span>` +
        `<p class="recovered-vec cand" data-field="candidate-a">` +
        `(${pair.first.map(fToString).join(', ')})</p>` +
        `<p>${verdictFor('cand-a', isConsistent(pair.first, observations), 'CONSISTENT WITH EVERY ANSWER', 'RULED OUT')}</p>` +
        `</div>` +
        `<div><span class="tag">CANDIDATE B</span>` +
        `<p class="recovered-vec cand" data-field="candidate-b">` +
        `(${pair.second.map(fToString).join(', ')})</p>` +
        `<p>${verdictFor('cand-b', isConsistent(pair.second, observations), 'CONSISTENT WITH EVERY ANSWER', 'RULED OUT')}</p>` +
        `</div>` +
        `</div>` +
        `<p>` +
        verdictFor(
          'two-candidates',
          isConsistent(pair.first, observations) &&
            isConsistent(pair.second, observations) &&
            !know.pinned,
          `${know.dimension} FREE ${know.dimension === 1 ? 'DIMENSION' : 'DIMENSIONS'} REMAIN — x IS NOT DETERMINED`,
          'CANDIDATE BOOKKEEPING IS WRONG',
        ) +
        `</p>` +
        `<p class="footnote">` +
        `Both are generated from the current solution set, so they are consistent by ` +
        `construction for any keys in any order. An earlier version of this lab pinned two ` +
        `fixed vectors instead; 7 of the 15 possible key subsets legitimately ruled the second ` +
        `one out, and the page misreported that correct answer as its own error.` +
        `</p>` +
        `</div>`
      : '';

  return (
    `<div class="stage-head">` +
    `<span class="step-num">STAGE 3 OF 4</span>` +
    `<h2>Each independent key removes one degree of freedom</h2>` +
    `<p class="lede">` +
    `A fixed 4-component vector is encrypted once. Request keys in any order and watch the ` +
    `matrix of issued questions grow &mdash; and watch what is still unknown shrink with it.` +
    `</p>` +
    `<p class="scenario-note">` +
    verdict('stage3-seeded', 'info', 'SEEDED SCENARIO — SEPARATE FROM THE BAR ABOVE') +
    `</p>` +
    `</div>` +
    `<div class="card">` +
    `<div class="controls">` +
    `<button class="btn" type="button" id="btn-reset-collect">Return all keys</button>` +
    `</div>` +
    `<h3>Keys the authority will issue</h3>` +
    `<ul class="key-list" role="list" aria-label="Functional keys available">${offers}</ul>` +
    renderMatrix(rows, {
      n,
      equation: 'Y x = b   —   one row per issued key',
      rhsHeading: 'answer',
      caption: 'The issued key vectors as rows of Y, with what each one added to the rank.',
      idPrefix: 'acc',
    }) +
    `<p role="status" aria-live="polite" data-field="knowledge-status">` +
    (know.pinned
      ? verdict('partial', 'warn', 'x IS NOW DETERMINED — ONE POINT')
      : verdictFor(
          'partial',
          know.dimension === n - know.rank,
          `x NOT DETERMINED — ${know.dimension} FREE ${know.dimension === 1 ? 'DIMENSION' : 'DIMENSIONS'} REMAIN`,
          'DIMENSION REPORTING IS WRONG',
        )) +
    `</p>` +
    (know.pinned
      ? ''
      : `<p class="footnote">` +
        `The solution set is <code data-field="family">${escapeHtml(know.description)}</code>. ` +
        `Only the family is drawn; naming a single x here would be the lie this stage exists to ` +
        `avoid.` +
        `</p>`) +
    `</div>` +
    candidateBlock
  );
}

/* ------------------------------------------------------------------ *
 * Stage 4 — Cross the authorization line
 * ------------------------------------------------------------------ */

export const STAGE4_OFFERS: readonly (readonly bigint[])[] = [
  ...RANK_DEFICIENT_YS,
  [0n, 1n, 0n, 0n],
  [0n, 0n, 0n, 1n],
];

export function renderCross(state: LabState): string {
  const n = 4;
  const src = seededSource('function-key/alone');
  const pair = setup(n, src);

  const held: FunctionalKey[] = state.aloneCollected.map((i) => keyDer(pair.msk, STAGE4_OFFERS[i]));
  const heldYs = held.map((k) => k.y);
  const r = ranks(heldYs, n);
  const recovery = recoverMasterSecret(held, n);

  const rows = analyseRows(heldYs, held.map((k) => `${k.sk.toString().slice(0, 8)}…`), n);

  // THE ISSUANCE CHALLENGE. Before each key is issued, say what it would do —
  // including the one that completes a basis and hands over the master secret.
  const offers = STAGE4_OFFERS.map((y, i) => {
    const taken = state.aloneCollected.includes(i);
    if (taken) {
      return (
        `<li><code>y = ${vec(y)}</code> ` +
        `<span class="verdict verdict-info" data-verdict="alone-offer-${i}">` +
        `<i class="verdict-icon" aria-hidden="true">i</i><span>ISSUED</span></span></li>`
      );
    }
    const wouldBe = rationalRank([...heldYs, y], n);
    const completes = wouldBe === n && r.overQ < n;
    const gains = wouldBe > r.overQ;
    const blocked = completes && !state.overrode;
    return (
      `<li${completes ? ' class="li-danger"' : ''}><code>y = ${vec(y)}</code> ` +
      (blocked
        ? `<button class="btn btn-danger" type="button" data-deny="${i}" disabled ` +
          `aria-label="Issuing this key would complete a basis">Issue</button> ` +
          `<span class="offer-note offer-danger" data-field="completes-basis">` +
          `rank ${r.overQ} &rarr; ${wouldBe} — <strong>this completes a basis and hands over s</strong>` +
          `</span>`
        : `<button class="btn" type="button" data-request-alone="${i}" ` +
          `aria-label="Issue a functional key for y equals ${y.join(', ')}">Issue</button> ` +
          `<span class="offer-note">` +
          (gains ? `rank ${r.overQ} &rarr; ${wouldBe}` : 'already in the issued span — adds nothing') +
          `</span>`) +
      `</li>`
    );
  }).join('');

  const gateBlock =
    recovery.kind !== 'recovered' && STAGE4_OFFERS.some((y, i) => {
      if (state.aloneCollected.includes(i)) return false;
      return rationalRank([...heldYs, y], n) === n;
    })
      ? `<div class="${state.overrode ? 'note-box' : 'alarm-box'}">` +
        `<h3>${state.overrode ? 'Override in force' : 'One more key crosses the line'}</h3>` +
        `<p data-field="policy-warning">` +
        `At least one key above would take the issued set to rank ${n}. Issuing it is not a ` +
        `break of anything &mdash; it is the authority deciding, in one click, to hand over the ` +
        `master secret. That is the operational rule worth taking away: ` +
        `<strong>authorization is span accounting.</strong>` +
        `</p>` +
        (state.overrode
          ? `<p>${verdict('policy-gate', 'warn', 'OVERRIDDEN — THE DANGEROUS KEY CAN NOW BE ISSUED')}</p>`
          : `<p>${verdict('policy-gate', 'ok', 'HELD — THE DANGEROUS KEY IS BLOCKED')}</p>` +
            `<button class="btn btn-danger" type="button" id="btn-override">` +
            `Issue it anyway</button>`) +
        `</div>`
      : '';

  let proof = '';
  if (recovery.kind === 'recovered') {
    const forged = forgeKey(recovery.s, NEVER_ISSUED_Y);
    const authentic = keyDer(pair.msk, NEVER_ISSUED_Y);
    const freshX = [4n, -1n, 3n, 2n];
    const freshCt = encrypt(pair.mpk, freshX, systemSource());
    const out = decrypt(freshCt, forged, DEFAULT_BOUND);
    const expected = dot(freshX, NEVER_ISSUED_Y);
    const got = out.dlog.found ? out.dlog.value : null;
    const neverIssued = !state.aloneCollected.some((i) =>
      STAGE4_OFFERS[i].every((v, j) => v === NEVER_ISSUED_Y[j]),
    );

    proof =
      `<div class="alarm-box">` +
      `<h3>A key the authority never approved</h3>` +
      `<p>` +
      `With s recovered, the analyst runs the authority's own KeyDer on a vector that was never ` +
      `requested, and applies it to a ciphertext created afterwards. The answer is correct. ` +
      `Nothing can tell the difference, because there is no difference &mdash; it is a genuine key.` +
      `</p>` +
      kv([
        [
          'y never issued',
          `${vec(NEVER_ISSUED_Y)} ${verdictFor('never-issued', neverIssued, 'NOT AMONG THE ISSUED KEYS', 'THIS KEY WAS ISSUED')}`,
        ],
        [
          'fresh ciphertext decrypts to',
          got === null
            ? `<span class="pending-int">not in range</span>`
            : `<span class="recovered-int">${got}</span>`,
        ],
      ]) +
      `<p>` +
      verdictFor(
        'master',
        got !== null && got === expected && forged.sk === authentic.sk,
        'FORGED KEY DECRYPTS A FRESH CIPHERTEXT CORRECTLY',
        'FORGED KEY DOES NOT WORK',
      ) +
      `</p>` +
      `<p class="footnote">` +
      `decrypted: <code data-field="computed">${got === null ? 'no value' : got}</code> &middot; ` +
      `expected: <code data-field="expected">${expected}</code>` +
      `</p>` +
      details(
        'Verify this — the forged key beside the authentic one',
        kv([
          ['forged sk<sub>y</sub>', `<span class="group-el">${forged.sk}</span>`],
          ["authority's own sk<sub>y</sub>", `<span class="group-el">${authentic.sk}</span>`],
          ['s recovered (mod &#8467;)', `<span class="group-el">${recovery.s.join(',<br>')}</span>`],
        ]),
      ) +
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
    `<div class="stage-head">` +
    `<span class="step-num">STAGE 4 OF 4</span>` +
    `<h2>Enough keys are the master secret &mdash; with no ciphertext at all</h2>` +
    `<p class="lede">` +
    `Nothing is encrypted here until the last step. The analyst holds only pairs ` +
    `<code>(y, sk<sub>y</sub>)</code>, and since <code>sk<sub>y</sub> = &lt;s, y&gt; mod ` +
    `&#8467;</code> each one is a linear equation in s. You are the authority. Decide what to ` +
    `issue.` +
    `</p>` +
    `<p class="scenario-note">` +
    verdict('stage4-seeded', 'info', 'SEEDED SCENARIO — SEPARATE FROM THE BAR ABOVE') +
    `</p>` +
    `</div>` +
    `<div class="card">` +
    `<div class="controls">` +
    `<button class="btn" type="button" id="btn-reset-alone">Revoke all keys</button>` +
    `</div>` +
    `<h3>Requests on your desk</h3>` +
    `<ul class="key-list" role="list" aria-label="Key requests awaiting a decision">${offers}</ul>` +
    renderMatrix(rows, {
      n,
      equation: 'Y s = sk   —   one row per issued key, no ciphertext involved',
      rhsHeading: 'sk_y',
      caption: 'The issued key vectors as rows of Y, with what each one added to the rank.',
      idPrefix: 'cross',
    }) +
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
        `${held.length} ${held.length === 1 ? 'key' : 'keys'} issued and still rank ` +
        `${recovery.rank}: a scalar multiple and an exact duplicate each add an equation that ` +
        `was already implied. The rank is shown rather than a recovered s, because printing one ` +
        `of the &#8467;<sup>${n - recovery.rank}</sup> candidate solutions as "the master ` +
        `secret" would be false.` +
        `</p>`
      : '') +
    `</div>` +
    gateBlock +
    proof
  );
}

/* ------------------------------------------------------------------ *
 * Evidence
 * ------------------------------------------------------------------ */

export function renderEvidence(state: LabState): string {
  return (
    `<div class="stage-head">` +
    `<span class="step-num">EVIDENCE</span>` +
    `<h2>What backs the four stages up</h2>` +
    `<p class="lede">` +
    `Everything here exists to be checked rather than read. None of it is required to follow ` +
    `the argument; all of it is required to trust it.` +
    `</p>` +
    `</div>` +
    renderFixtures() +
    renderCompare() +
    renderHonesty(state)
  );
}

function renderFixtures(): string {
  const rows = CORRECTNESS_FIXTURES.map((f) => {
    const src = seededSource(f.seed);
    const pair = setup(f.n, src);
    const ct = encrypt(pair.mpk, f.x, src);
    const out = decrypt(ct, keyDer(pair.msk, f.y), 2048n);
    const computed = out.dlog.found ? out.dlog.value : null;
    const pass = computed !== null && computed === f.claimed;
    return (
      `<tr data-row-state="${pass ? 'pass' : 'fail'}" data-fixture="${escapeHtml(f.id)}">` +
      `<td>${escapeHtml(f.label)}</td><td class="num">${f.n}</td>` +
      `<td class="num">${vec(f.x)}</td><td class="num">${vec(f.y)}</td>` +
      `<td class="num" data-field="computed">${computed === null ? 'no value' : computed}</td>` +
      `<td class="num" data-field="expected">${f.claimed}</td>` +
      `<td>${verdictFor(`fixture-${f.id}`, pass, 'AGREES', 'DISAGREES')}</td></tr>`
    );
  }).join('');

  const wrong = CORRECTNESS_FIXTURES.filter((f) => f.wrongOnPurpose);

  return (
    `<div class="card">` +
    `<h3>Fixtures, including one that is wrong on purpose</h3>` +
    `<p>` +
    `Each row seeds s and r, runs the real Setup, KeyDer, Encrypt and Decrypt, and compares the ` +
    `recovered integer against what the row claims. Both numbers are printed on every row, ` +
    `always &mdash; a badge that is the only evidence for its own claim cannot be checked.` +
    `</p>` +
    `<div class="table-scroll" tabindex="0" role="region" aria-label="Correctness fixtures">` +
    `<table><caption>Computed by the scheme; claimed by the fixture.</caption>` +
    `<thead><tr><th scope="col">fixture</th><th scope="col" class="num">n</th>` +
    `<th scope="col" class="num">x</th><th scope="col" class="num">y</th>` +
    `<th scope="col" class="num">computed</th><th scope="col" class="num">claimed</th>` +
    `<th scope="col">verdict</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    `<p>` +
    verdictFor(
      'wrong-fixture-detected',
      wrong.length === 1 &&
        wrong.every((f) => {
          const src = seededSource(f.seed);
          const pair = setup(f.n, src);
          const ct = encrypt(pair.mpk, f.x, src);
          const out = decrypt(ct, keyDer(pair.msk, f.y), 2048n);
          return out.dlog.found && out.dlog.value !== f.claimed;
        }),
      'THE DELIBERATELY WRONG ROW IS REPORTED AS DISAGREEING',
      'THE WRONG ROW WAS NOT CAUGHT',
    ) +
    `</p>` +
    `<p class="footnote">` +
    `The last row claims 16 where its own x and y give 15. It is not a bug and not to be fixed: ` +
    `a table only ever seen agreeing is not evidence, because a change forcing the comparison ` +
    `always-true would look identical from here.` +
    `</p>` +
    details(
      'On the absence of official vectors',
      `<p>` +
      `There are no standardized IPFE test vectors, so nothing here is labelled as one. What ` +
      `<em>is</em> pinned to a published source is the layer underneath: ristretto255 is checked ` +
      `against all of RFC 9496 Appendix A &mdash; 16 generator multiples in both directions, 29 ` +
      `encodings that must be rejected, 8 one-way-map outputs &mdash; before any scheme code ` +
      `runs on it. FENTEC's GoFE and CiFEr implement ABDP15 but over a different group, so ` +
      `matching their outputs would mean re-deriving them here, which proves nothing. Skipped, ` +
      `and recorded as skipped.` +
      `</p>`,
    ) +
    `</div>`
  );
}

function renderCompare(): string {
  return (
    `<div class="card">` +
    `<h3>Three different questions, three different tools</h3>` +
    `<div class="compare-grid">` +
    `<div><span class="tag">ABE</span>` +
    `<h4>Controls <em>whether</em> the plaintext is released</h4>` +
    `<p>A policy decides who may decrypt. Satisfy it and you get the whole message.</p>` +
    `<p class="footnote">` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-attribute-gate/" target="_blank" rel="noopener noreferrer">Attribute Gate</a> ` +
    `implements FAME CP-ABE over BLS12-381 and leads on collusion resistance.` +
    `</p></div>` +
    `<div><span class="tag">IPFE &middot; THIS LAB</span>` +
    `<h4>Controls <em>which function</em> is released</h4>` +
    `<p>Everyone authorized gets an answer; the key decides which answer.</p>` +
    `<p class="footnote">` +
    `The contrast worth drawing: collusion in ABE means combining attributes to satisfy a ` +
    `policy neither key satisfies alone, and FAME resists it. Collusion here is a different ` +
    `thing &mdash; the keys combine <em>linearly, exactly as authorized</em>, and what they add ` +
    `up to is the plaintext. Nothing is resisted because nothing is broken.` +
    `</p></div>` +
    `<div><span class="tag">FHE</span>` +
    `<h4>Computes <em>without learning</em> the plaintext</h4>` +
    `<p>The party doing the work stays blind; the key holder learns the result.</p>` +
    `<p class="footnote">` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-fhe-arena/" target="_blank" rel="noopener noreferrer">FHE Arena</a>, ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-ckks-lab/" target="_blank" rel="noopener noreferrer">CKKS Lab</a> and ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-blind-oracle/" target="_blank" rel="noopener noreferrer">Blind Oracle</a>.` +
    `</p></div>` +
    `</div>` +
    `<p class="footnote">` +
    `This lab does not reteach DDH or ElGamal. If "cannot tell g<sup>ab</sup> from random" is ` +
    `new, start with ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-elgamal-plain/" target="_blank" rel="noopener noreferrer">ElGamal Plain</a> or ` +
    `<a href="https://systemslibrarian.github.io/crypto-lab-curve-lens/" target="_blank" rel="noopener noreferrer">Curve Lens</a>.` +
    `</p>` +
    `</div>`
  );
}

function renderHonesty(state: LabState): string {
  const src = seededSource('function-key/malleable');
  const pair = setup(4, src);
  const x = [2n, 1n, 3n, 0n];
  const xp = [1n, 4n, -2n, 5n];
  const y = [3n, 1n, 2n, 1n];
  const key = keyDer(pair.msk, y);
  const mauled = combineCiphertexts(encrypt(pair.mpk, x, src), encrypt(pair.mpk, xp, src));
  const out = decrypt(mauled, key, DEFAULT_BOUND);
  const sum = x.map((v, i) => v + xp[i]);
  const expectedSum = dot(sum, y);
  const got = out.dlog.found ? out.dlog.value : null;
  const original = dot(x, y);

  const decrypted = got !== null;
  const correct = got !== null && got === expectedSum;
  const moved = got !== null && got !== original;

  return (
    `<div class="card">` +
    `<h3>Real, modeled, not implemented</h3>` +
    `<div class="honesty-cols">` +
    `<div><h4>Real</h4><ul>` +
    `<li>ristretto255 via <code>@noble/curves</code>, pinned to RFC 9496 Appendix A</li>` +
    `<li>ABDP15 Construction 3.1, implemented here</li>` +
    `<li>Baby-step giant-step with an exact operation counter</li>` +
    `<li>Reconstruction and master-secret recovery in exact arithmetic</li>` +
    `</ul></div>` +
    `<div><h4>Modeled</h4><ul>` +
    `<li>Authority and analyst are columns on one page; no key-distribution protocol</li>` +
    `<li>Key material is per-session and in memory; nothing is persisted</li>` +
    `<li>Wall-clock timings are machine-dependent; operation counts are not</li>` +
    `<li>Stages 3 and 4 are seeded scenarios, separate from the bar at the top</li>` +
    `</ul></div>` +
    `<div><h4>Not implemented</h4><ul>` +
    `<li>Adaptive security. ABDP15 Theorem 3.2 proves <em>selective</em> IND-FE-CPA; ALS16 gets adaptive and is not built here</li>` +
    `<li>The Paillier variant that removes the small-output bound</li>` +
    `<li>General-function FE, function-hiding, multi-input and multi-client IPFE</li>` +
    `<li>Any CCA security whatever</li>` +
    `</ul></div>` +
    `</div>` +
    details(
      'Threat model',
      `<ul>` +
      `<li>The authority is trusted to generate keys honestly.</li>` +
      `<li>Key holders may collude; stages 3 and 4 show exactly what collusion yields.</li>` +
      `<li>Security is selective IND-FE-CPA under DDH (ABDP15 Theorem 3.2).</li>` +
      `<li>No CCA security, and no integrity of any kind.</li>` +
      `</ul>`,
    ) +
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
    verdict(
      'negative-claim-verdict',
      'warn',
      correct && moved ? 'DECRYPTED — AND MODIFIED' : 'FIXTURE DID NOT REACH THE MALLEABLE STATE',
    ) +
    `</p>` +
    details(
      'Verify this — every check passes on a mauled ciphertext',
      `<p>` +
      `Two ciphertexts multiplied componentwise by a party holding no key. The product is a ` +
      `well-formed encryption of the sum under randomness r + r&#39;, so every check succeeds ` +
      `and the key returns a correct answer &mdash; to a question nobody asked.` +
      `</p>` +
      `<div class="table-scroll" tabindex="0" role="region" aria-label="Malleability exhibit">` +
      `<table><thead><tr><th scope="col">step</th><th scope="col" class="num">value</th>` +
      `<th scope="col">verdict</th></tr></thead><tbody>` +
      `<tr><td>&lt;x, y&gt; &mdash; what the authority expected</td>` +
      `<td class="num">${original}</td><td>&mdash;</td></tr>` +
      `<tr><td>ct(x) &#8857; ct(x&#39;) decrypts to</td>` +
      `<td class="num" data-field="computed">${got === null ? 'no value' : got}</td>` +
      `<td>${verdictFor('maul-decrypts', decrypted, 'DECRYPTION SUCCEEDED', 'DECRYPTION FAILED')}</td></tr>` +
      `<tr><td>&lt;x + x&#39;, y&gt; &mdash; expected for the mauled ciphertext</td>` +
      `<td class="num" data-field="expected">${expectedSum}</td>` +
      `<td>${verdictFor('maul-correct', correct, 'ANSWER IS ARITHMETICALLY CORRECT', 'ANSWER IS WRONG')}</td></tr>` +
      `<tr><td>Did any check report tampering?</td><td class="num">no</td>` +
      `<td>${verdictFor('maul-undetected', moved, 'NO FAILURE CODE EXISTS TO RAISE', 'THE PLAINTEXT WAS UNCHANGED')}</td></tr>` +
      `</tbody></table></div>` +
      `<p class="footnote">` +
      `The absence of a failure code is the exhibit. ABDP15 claims CPA security and nothing ` +
      `more, so there is no integrity check here to fail, and inventing one to look thorough ` +
      `would teach the opposite of the lesson.` +
      `</p>`,
    ) +
    `</div>` +
    `<div class="card">` +
    `<h3>Primary sources</h3>` +
    `<ul>` +
    `<li>Abdalla, Bourse, De Caro, Pointcheval, <em>Simple Functional Encryption Schemes for ` +
    `Inner Products</em>, PKC 2015; ` +
    `<a href="https://eprint.iacr.org/2015/017" target="_blank" rel="noopener noreferrer">ePrint 2015/017</a> ` +
    `&mdash; Construction 3.1 and Theorem 3.2, the scheme built here.</li>` +
    `<li>Agrawal, Libert, Stehl&eacute;, <em>Fully Secure Functional Encryption for Inner ` +
    `Products, from Standard Assumptions</em>, CRYPTO 2016; ` +
    `<a href="https://eprint.iacr.org/2015/608" target="_blank" rel="noopener noreferrer">ePrint 2015/608</a> ` +
    `&mdash; adaptive security. It attributes removing the small-interval restriction to ` +
    `<strong>Paillier</strong> specifically; its LWE schemes keep short coordinates and add ` +
    `inner products modulo a prime instead.</li>` +
    `<li>Boneh, Sahai, Waters, <em>Functional Encryption: Definitions and Challenges</em>, ` +
    `TCC 2011, LNCS 6597, pp. 253&ndash;273; ` +
    `<a href="https://eprint.iacr.org/2010/543" target="_blank" rel="noopener noreferrer">ePrint 2010/543</a> ` +
    `&mdash; the definitions. The ePrint year (2010) differs from the conference year.</li>` +
    `<li><a href="https://www.rfc-editor.org/rfc/rfc9496.html" target="_blank" rel="noopener noreferrer">RFC 9496</a> ` +
    `&mdash; the group, and the Appendix A vectors the library is pinned against.</li>` +
    `</ul>` +
    `<p class="footnote">` +
    `Notation: ABDP15 writes the dimension as &#8467; and the group order as p. This lab follows ` +
    `RFC 9496 and writes the group order as &#8467;, calling the dimension n. Current settings: ` +
    `n = ${state.n}, B = ${state.bound}. Cap B = ${MAX_BOUND}.` +
    `</p>` +
    `</div>`
  );
}

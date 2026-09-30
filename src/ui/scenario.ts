/**
 * The scenario bar: one persistent set of controls, directly under the hero.
 *
 * Two problems this solves at once.
 *
 * FIRST INTERACTION ABOVE THE FOLD. Before this, the first control on the page
 * sat about 998px down on a 1440x900 desktop and about 1893px down on a
 * 390x844 phone — more than two phone viewports of header, hero, intro, tab
 * list and heading before anything could be touched. The vectors now sit
 * immediately under the hero, so the thing the lab is about is the first thing
 * on screen.
 *
 * NO CROSS-STAGE SCAVENGER HUNT. Two of the lab's demonstrations used to
 * require setup in a different panel from the result: proving randomized
 * encryption meant going back to exhibit 1 to press "Encrypt again", and
 * reaching the out-of-range refusal meant changing B in exhibit 3 and
 * returning to exhibit 2. Both controls live here now, visible from wherever
 * the reader is, so no stage depends on the reader guessing that a control
 * somewhere else unlocks its evidence.
 *
 * The expected answer is shown deliberately. It does not spoil the staged
 * decryption in stage 2 — it sharpens it. You typed x, so you already know
 * what the weighted sum is; the point of the next stage is that the machine
 * has finished decrypting and still does not.
 */

import { ENTRY_MAX, ENTRY_MIN, MAX_N } from '../crypto/types';
import { MAX_BOUND } from '../crypto/dlog';
import { escapeHtml } from './dom';
import type { LabState } from './state';

function vecField(name: 'x' | 'y', values: readonly bigint[], label: string, hint: string): string {
  return (
    `<div class="sc-vec">` +
    `<span class="sc-label" id="sc-lbl-${name}">${escapeHtml(label)}</span>` +
    `<div class="vec-inputs" role="group" aria-labelledby="sc-lbl-${name}">` +
    values
      .map(
        (v, i) =>
          `<input type="number" data-vec="${name}" data-index="${i}" value="${v}" ` +
          `min="${ENTRY_MIN}" max="${ENTRY_MAX}" step="1" ` +
          `aria-label="${escapeHtml(label)} component ${i + 1}" />`,
      )
      .join('') +
    `</div>` +
    `<span class="sc-hint">${escapeHtml(hint)}</span>` +
    `</div>`
  );
}

export function renderScenario(state: LabState, expected: bigint): string {
  const log2 = (n: bigint): number => {
    let e = 0;
    let v = n;
    while (v > 1n) {
      v >>= 1n;
      e++;
    }
    return e;
  };

  return (
    `<section class="scenario" aria-label="Scenario">` +
    `<div class="sc-equation">` +
    vecField('x', state.x, 'encrypted vector x', 'secret — only the authority knows it') +
    `<span class="sc-op" aria-hidden="true">&#10754;</span>` +
    vecField('y', state.y, 'key vector y', 'public — the question being authorized') +
    `<span class="sc-op" aria-hidden="true">&rarr;</span>` +
    `<div class="sc-answer">` +
    `<span class="sc-label">one answer &lt;x, y&gt;</span>` +
    `<output class="sc-value" data-field="scenario-expected" for="">${expected}</output>` +
    `<span class="sc-hint">you know this because you typed x</span>` +
    `</div>` +
    `</div>` +
    `<div class="sc-controls">` +
    `<div class="field">` +
    `<label for="n-select">dimension n</label>` +
    `<select id="n-select">` +
    Array.from({ length: MAX_N }, (_, i) => i + 1)
      .map((i) => `<option value="${i}"${i === state.n ? ' selected' : ''}>${i}</option>`)
      .join('') +
    `</select>` +
    `</div>` +
    `<div class="field field-grow">` +
    `<label for="bound-slider">search bound B = ${state.bound}</label>` +
    `<input type="range" id="bound-slider" min="3" max="${log2(MAX_BOUND)}" step="1" ` +
    `value="${log2(state.bound)}" aria-describedby="bound-readout" />` +
    `</div>` +
    `<button class="btn" id="btn-reencrypt" type="button">Encrypt again</button>` +
    `<button class="btn" id="btn-reset" type="button">Reset</button>` +
    `</div>` +
    `<p class="sc-readout footnote" id="bound-readout" role="status" aria-live="polite">` +
    `B = ${state.bound}; the search covers [&minus;${state.bound}, ${state.bound}], ` +
    `width W = ${2n * state.bound + 1n}.` +
    (expected > state.bound || expected < -state.bound
      ? ` <strong>The current answer ${expected} is OUTSIDE that range</strong> — stage 2 will refuse rather than return it.`
      : ` The current answer ${expected} is inside it.`) +
    `</p>` +
    `</section>`
  );
}

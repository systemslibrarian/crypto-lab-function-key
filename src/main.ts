/**
 * Wiring: stage navigation, URL state, control events, and the search worker.
 *
 * Three things here are load-bearing rather than plumbing.
 *
 * THE GENERATION GUARD. Every worker reply is checked against
 * `state.generation` before it is allowed to paint. Anything that changes what
 * <x, y> means bumps that counter, so a search started against one ciphertext
 * can never publish its answer beside different inputs. Without it, editing a
 * vector mid-search paints a stale integer that looks authoritative.
 *
 * URL STATE. Each stage owns a hash, and back/forward move between stages
 * rather than leaving the page. A long-form teaching page that cannot be
 * linked to at a particular point is one people cannot cite.
 *
 * REAL `hidden`, NEVER A DISPLAY CLASS. Stage panels are toggled with
 * `el.hidden` and no CSS rule anywhere sets `display` on `.panel`, so there is
 * no way for a panel to paint while the code believes it is hidden — the
 * `[hidden]` cascade trap the a11y gate probes for.
 */

import './styles.css';
import {
  STAGE3_OFFERS,
  STAGE4_OFFERS,
  renderAccumulate,
  renderAsk,
  renderCross,
  renderDecode,
  renderEvidence,
} from './ui/stages';
import { renderScenario } from './ui/scenario';
import { parseEntry } from './ui/dom';
import { ENTRY_MAX, ENTRY_MIN } from './crypto/types';
import { decryptToElement, keyDer } from './crypto/ipfe';
import { COST_LAW_BOUNDS } from './crypto/fixtures';
import { DlogSearcher } from './ui/search';
import {
  STAGES,
  STAGE_TITLES,
  currentAnswer,
  invalidate,
  makeState,
  reencrypt,
  reset,
  resize,
  type LabState,
  type StageId,
} from './ui/state';

const state: LabState = makeState();
const searcher = new DlogSearcher();
let active: StageId = 'ask';

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderStage(id: StageId): string {
  if ((id === 'ask' || id === 'decode') && Object.keys(state.entryDrafts).length > 0) {
    return `<div class="note-box"><h2>Complete the vector entries</h2>` +
      `<p role="alert">Enter a whole decimal number from ${ENTRY_MIN} to ${ENTRY_MAX} ` +
      `in every vector field. The previous result has been cleared.</p></div>`;
  }
  switch (id) {
    case 'ask':
      return renderAsk(state);
    case 'decode':
      return renderDecode(state, searcher.degraded);
    case 'accumulate':
      return renderAccumulate(state);
    case 'cross':
      return renderCross(state);
    case 'evidence':
      return renderEvidence(state);
  }
}

function paintScenario(): void {
  const host = document.getElementById('scenario-host');
  if (host) host.innerHTML = renderScenario(state,
    Object.keys(state.entryDrafts).length === 0 ? currentAnswer(state) : null);
}

function paintStage(): void {
  const host = document.getElementById(`panel-${active}`);
  if (host) {
    // Worker replies redraw the active panel while a reader may be using it.
    // Retain the reader's open/closed disclosures and focused summary across
    // that redraw, using each existing summary's stable text as its identity.
    const name = (detail: HTMLDetailsElement): string =>
      detail.querySelector(':scope > summary')?.textContent?.trim() ?? '';
    const before = [...host.querySelectorAll<HTMLDetailsElement>('details.disclose')];
    const states = new Map(before.map((detail) => [name(detail), detail.open]));
    const focused = before.find((detail) =>
      detail.querySelector(':scope > summary') === document.activeElement);
    const focusedName = focused ? name(focused) : null;
    host.innerHTML = renderStage(active);
    for (const detail of host.querySelectorAll<HTMLDetailsElement>('details.disclose')) {
      const key = name(detail);
      if (states.has(key)) detail.open = states.get(key)!;
      if (key === focusedName) detail.querySelector<HTMLElement>(':scope > summary')?.focus();
    }
  }
  paintStageNav();
}

function paintStageNav(): void {
  const i = STAGES.indexOf(active);
  const prev = document.getElementById('btn-prev') as HTMLButtonElement | null;
  const next = document.getElementById('btn-next') as HTMLButtonElement | null;
  if (prev) {
    prev.disabled = i === 0;
    prev.textContent = i === 0 ? 'Previous' : `← ${STAGE_TITLES[STAGES[i - 1]]}`;
  }
  if (next) {
    next.disabled = i === STAGES.length - 1;
    next.textContent =
      i === STAGES.length - 1 ? 'Next' : `${STAGE_TITLES[STAGES[i + 1]]} →`;
  }
  const prog = document.getElementById('stage-progress');
  if (prog) {
    prog.textContent = `Stage ${Math.min(i + 1, 4)} of 4${active === 'evidence' ? ' — plus evidence' : ''}`;
  }
}

/**
 * Repaint whichever surfaces the current interaction touched, then restore the
 * caret.
 *
 * Repainting a panel replaces the input being typed into, which drops focus
 * after every keystroke and makes the vector fields unusable with a keyboard.
 * The focused control is re-identified afterwards by the stable attributes the
 * markup already carries. Keyboard operability is a gate requirement, not a
 * nicety, so this is load-bearing.
 */
function repaint(opts: { scenario?: boolean; stage?: boolean } = {}): void {
  const before = document.activeElement as HTMLInputElement | HTMLSelectElement | null;
  const id = before?.id || '';
  const vecName = (before as HTMLInputElement | null)?.dataset?.vec ?? '';
  const vecIndex = (before as HTMLInputElement | null)?.dataset?.index ?? '';
  const caret =
    before && 'selectionStart' in before ? (before as HTMLInputElement).selectionStart : null;

  if (opts.scenario) paintScenario();
  if (opts.stage !== false) paintStage();

  const selector = id
    ? `#${CSS.escape(id)}`
    : vecName
      ? `input[data-vec="${vecName}"][data-index="${vecIndex}"]`
      : '';
  if (!selector) return;
  const after = document.querySelector<HTMLInputElement>(selector);
  if (!after) return;
  after.focus();
  if (caret !== null && after.type !== 'range') {
    try {
      after.setSelectionRange(caret, caret);
    } catch {
      // Some input types refuse selection APIs; focus alone is the win.
    }
  }
}

/* ------------------------------------------------------------------ *
 * Stage navigation
 * ------------------------------------------------------------------ */

function selectStage(id: StageId, opts: { focus?: boolean; push?: boolean } = {}): void {
  active = id;
  for (const s of STAGES) {
    const btn = document.getElementById(`tab-${s}`);
    const panel = document.getElementById(`panel-${s}`);
    if (!btn || !panel) continue;
    const on = s === id;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) btn.removeAttribute('tabindex');
    else btn.setAttribute('tabindex', '-1');
    panel.hidden = !on;
    if (!on) panel.innerHTML = '';
  }
  paintStage();

  if (opts.push !== false && window.location.hash !== `#${id}`) {
    history.pushState({ stage: id }, '', `#${id}`);
  }
  if (opts.focus) document.getElementById(`tab-${id}`)?.focus();
}

function stageFromHash(): StageId {
  const h = window.location.hash.replace(/^#/, '');
  return (STAGES as readonly string[]).includes(h) ? (h as StageId) : 'ask';
}

/* ------------------------------------------------------------------ *
 * The search, and the cost measurement
 * ------------------------------------------------------------------ */

async function runSearch(): Promise<void> {
  const generation = state.generation;
  state.decode = 'searching';
  repaint();

  const key = keyDer(state.keys.msk, state.y);
  const element = decryptToElement(state.ciphertext, key);
  let outcome;
  try {
    outcome = await searcher.search(element, state.bound);
  } catch {
    if (generation !== state.generation) return;
    state.decode = 'failed';
    state.decodeResult = null;
    repaint();
    return;
  }

  // Superseded, or the question changed underneath it. Dropping the reply is
  // the whole point of the guard.
  if (outcome === null || generation !== state.generation) return;

  state.decodeResult = {
    found: outcome.found,
    value: outcome.value,
    ops: outcome.ops,
    tableSize: outcome.tableSize,
    elapsedMs: outcome.elapsedMs,
    generation,
  };
  state.decode = 'done';
  repaint();
}

async function measureCost(): Promise<void> {
  if (state.cost !== null || state.costPending) return;
  state.costPending = true;
  state.costFailed = false;
  try {
    state.cost = await searcher.measureCost(COST_LAW_BOUNDS);
  } catch {
    state.cost = null;
    state.costFailed = true;
  } finally {
    state.costPending = false;
  }
  if (active === 'decode') repaint();
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

function wireNav(): void {
  const list = document.querySelector('.tab-list');
  list?.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-panel]');
    if (!btn) return;
    selectStage(btn.dataset.panel as StageId);
  });

  list?.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const i = STAGES.indexOf(active);
    const go = (j: number): void => {
      e.preventDefault();
      selectStage(STAGES[(j + STAGES.length) % STAGES.length], { focus: true });
    };
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(STAGES.length - 1);
  });

  document.getElementById('btn-prev')?.addEventListener('click', () => {
    const i = STAGES.indexOf(active);
    if (i > 0) selectStage(STAGES[i - 1]);
  });
  document.getElementById('btn-next')?.addEventListener('click', () => {
    const i = STAGES.indexOf(active);
    if (i < STAGES.length - 1) selectStage(STAGES[i + 1]);
  });

  window.addEventListener('popstate', () => {
    selectStage(stageFromHash(), { push: false });
  });
}

function wireScenario(): void {
  const host = document.getElementById('scenario-host');
  if (!host) return;

  host.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement | null)?.closest<HTMLElement>('button');
    if (!t) return;
    if (t.id === 'btn-reencrypt') {
      reencrypt(state);
      searcher.cancelSearches();
      repaint({ scenario: true });
    } else if (t.id === 'btn-reset') {
      reset(state);
      searcher.cancelSearches();
      repaint({ scenario: true });
    }
  });

  host.addEventListener('input', (ev) => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement | null;
    if (!el) return;

    if (el.id === 'bound-slider') {
      state.bound = 2n ** BigInt(Number((el as HTMLInputElement).value));
      invalidate(state);
      searcher.cancelSearches();
      repaint({ scenario: true });
      return;
    }
    if (el.id === 'n-select') {
      resize(state, Number((el as HTMLSelectElement).value));
      searcher.cancelSearches();
      repaint({ scenario: true });
      return;
    }
    const which = (el as HTMLInputElement).dataset.vec;
    if (which === 'x' || which === 'y') {
      const idx = Number((el as HTMLInputElement).dataset.index);
      const raw = (el as HTMLInputElement).value;
      const val = parseEntry(raw, ENTRY_MIN, ENTRY_MAX);
      const draft = `${which}-${idx}`;
      if (val === null) {
        state.entryDrafts[draft] = raw;
        invalidate(state);
        searcher.cancelSearches();
        el.setAttribute('aria-invalid', 'true');
        // Preserve the live field while a minus sign or empty value is being
        // typed; replacing a number input here destroys that intermediate edit.
        repaint();
        const expected = host.querySelector('[data-field="scenario-expected"]');
        if (expected) expected.textContent = '—';
        const readout = host.querySelector('#bound-readout');
        if (readout) readout.textContent =
          `Enter a whole decimal number from ${ENTRY_MIN} to ${ENTRY_MAX} in every vector field.`;
        return;
      }
      delete state.entryDrafts[draft];
      if (which === 'x') {
        state.x[idx] = val;
        // x changed, so the ciphertext must be rebuilt: it encrypts x.
        reencrypt(state);
      } else {
        state.y[idx] = val;
        invalidate(state);
      }
      searcher.cancelSearches();
      repaint({ scenario: true });
    }
  });
}

function wireStages(): void {
  const main = document.querySelector('main');
  main?.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement | null)?.closest<HTMLElement>('button');
    if (!t || t.hasAttribute('disabled')) return;

    if (t.id === 'btn-retry-cost') {
      state.cost = null;
      void measureCost();
      repaint();
      return;
    }

    if (t.id === 'btn-apply') {
      state.decode = 'applied';
      repaint();
      return;
    }
    if (t.id === 'btn-recover' || t.id === 'btn-redo-search') {
      void runSearch();
      return;
    }
    if (t.id === 'btn-restart-decode') {
      searcher.cancelSearches();
      invalidate(state);
      repaint();
      return;
    }
    if (t.id === 'btn-reset-collect') {
      state.collected = [];
      repaint();
      return;
    }
    if (t.id === 'btn-reset-alone') {
      state.aloneCollected = [];
      state.overrode = false;
      repaint();
      return;
    }
    if (t.id === 'btn-override') {
      state.overrode = true;
      repaint();
      return;
    }
    const req = t.dataset.requestKey;
    if (req !== undefined) {
      const i = Number(req);
      if (i >= 0 && i < STAGE3_OFFERS.length && !state.collected.includes(i)) {
        state.collected.push(i);
      }
      repaint();
      return;
    }
    const alone = t.dataset.requestAlone;
    if (alone !== undefined) {
      const i = Number(alone);
      if (i >= 0 && i < STAGE4_OFFERS.length && !state.aloneCollected.includes(i)) {
        state.aloneCollected.push(i);
      }
      repaint();
    }
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot(): void {
  paintScenario();
  wireNav();
  wireScenario();
  wireStages();
  selectStage(stageFromHash(), { push: false });
  // Measure the cost curve once, in the background. It is the same worker the
  // staged search uses, so this also proves the worker is alive before the
  // reader presses anything.
  void measureCost();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

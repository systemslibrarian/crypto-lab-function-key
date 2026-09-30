/**
 * Wiring: tab state, control events, and re-render.
 *
 * Panels are rendered on demand and the tab panels use the real `hidden`
 * attribute, toggled by `el.hidden`. No class rule anywhere sets `display` on a
 * `.panel`, so there is no way for a panel to paint while the code believes it
 * is hidden — the `[hidden]` cascade trap the a11y gate probes for.
 */

import './styles.css';
import {
  ACT4_OFFERS,
  ACT5_OFFERS,
  makeState,
  regenerate,
  reencrypt,
  renderAlone,
  renderBottleneck,
  renderCollect,
  renderCompare,
  renderDecrypt,
  renderFixtures,
  renderHonesty,
  renderKeys,
  type LabState,
} from './ui/panels';
import { clampEntry } from './ui/dom';
import { ENTRY_MAX, ENTRY_MIN } from './crypto/types';
import { setup, encrypt } from './crypto/ipfe';
import { systemSource } from './crypto/prng';

type PanelId =
  | 'keys'
  | 'decrypt'
  | 'bottleneck'
  | 'collect'
  | 'alone'
  | 'fixtures'
  | 'compare'
  | 'honesty';

const PANELS: readonly PanelId[] = [
  'keys',
  'decrypt',
  'bottleneck',
  'collect',
  'alone',
  'fixtures',
  'compare',
  'honesty',
];

const state: LabState = makeState();
let active: PanelId = 'keys';

function renderPanel(id: PanelId): string {
  switch (id) {
    case 'keys':
      return renderKeys(state);
    case 'decrypt':
      return renderDecrypt(state);
    case 'bottleneck':
      return renderBottleneck(state);
    case 'collect':
      return renderCollect(state);
    case 'alone':
      return renderAlone(state);
    case 'fixtures':
      return renderFixtures();
    case 'compare':
      return renderCompare();
    case 'honesty':
      return renderHonesty(state);
  }
}

function paint(): void {
  const host = document.getElementById(`panel-${active}`);
  if (!host) return;
  host.innerHTML = renderPanel(active);
}

/**
 * Re-render, then put the caret back where it was.
 *
 * Repainting a whole panel replaces the input the reader is typing into, which
 * drops focus after every keystroke and makes the vector fields and the bound
 * slider unusable with a keyboard. Rather than splitting the render into
 * output-only fragments, the focused control is re-identified after the paint
 * by the same stable attributes the markup already carries, and its selection
 * offset is restored. Keyboard operability is a gate requirement, not a
 * nicety, so this is load-bearing.
 */
function paintPreservingFocus(): void {
  const before = document.activeElement as HTMLInputElement | HTMLSelectElement | null;
  const id = before?.id || '';
  const vecName = (before as HTMLInputElement | null)?.dataset?.vec ?? '';
  const vecIndex = (before as HTMLInputElement | null)?.dataset?.index ?? '';
  const caret =
    before && 'selectionStart' in before ? (before as HTMLInputElement).selectionStart : null;

  paint();

  const selector = id
    ? `#${id}`
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
      // Some input types refuse selection APIs; focus alone is the win here.
    }
  }
}

function selectTab(id: PanelId, focus = true): void {
  active = id;
  for (const p of PANELS) {
    const btn = document.getElementById(`tab-${p}`);
    const panel = document.getElementById(`panel-${p}`);
    if (!btn || !panel) continue;
    const on = p === id;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) btn.removeAttribute('tabindex');
    else btn.setAttribute('tabindex', '-1');
    // Toggle the real attribute, never a display class.
    panel.hidden = !on;
    if (!on) panel.innerHTML = '';
  }
  paint();
  if (focus) document.getElementById(`tab-${id}`)?.focus();
}

/** Rebuild keys and ciphertext for a new dimension, truncating or padding x and y. */
function resize(n: number): void {
  const fit = (v: bigint[]): bigint[] => {
    const out = v.slice(0, n);
    while (out.length < n) out.push(1n);
    return out;
  };
  state.n = n;
  state.x = fit(state.x);
  state.y = fit(state.y);
  const source = systemSource();
  state.keys = setup(n, source);
  state.ciphertext = encrypt(state.keys.mpk, state.x, source);
}

function wireTabs(): void {
  const list = document.querySelector('.tab-list');
  if (!list) return;

  list.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-panel]');
    if (!btn) return;
    selectTab(btn.dataset.panel as PanelId, false);
  });

  // Arrow-key navigation across the tablist, per the ARIA tabs pattern.
  list.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const i = PANELS.indexOf(active);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      selectTab(PANELS[(i + 1) % PANELS.length]);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      selectTab(PANELS[(i - 1 + PANELS.length) % PANELS.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      selectTab(PANELS[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      selectTab(PANELS[PANELS.length - 1]);
    }
  });
}

function wirePanelEvents(): void {
  const main = document.querySelector('main');
  if (!main) return;

  main.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement | null)?.closest<HTMLElement>('button');
    if (!t) return;

    if (t.id === 'btn-regen') {
      regenerate(state);
      paint();
      return;
    }
    if (t.id === 'btn-reencrypt') {
      reencrypt(state);
      paint();
      return;
    }
    if (t.id === 'btn-reset-collect') {
      state.collected = [];
      paint();
      return;
    }
    if (t.id === 'btn-reset-alone') {
      state.aloneCollected = [];
      paint();
      return;
    }
    const req = t.dataset.requestKey;
    if (req !== undefined) {
      const i = Number(req);
      if (i >= 0 && i < ACT4_OFFERS.length && !state.collected.includes(i)) {
        state.collected.push(i);
      }
      paint();
      return;
    }
    const alone = t.dataset.requestAlone;
    if (alone !== undefined) {
      const i = Number(alone);
      if (i >= 0 && i < ACT5_OFFERS.length && !state.aloneCollected.includes(i)) {
        state.aloneCollected.push(i);
      }
      paint();
    }
  });

  main.addEventListener('input', (ev) => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement | null;
    if (!el) return;

    if (el.id === 'bound-slider') {
      const e = Number((el as HTMLInputElement).value);
      state.bound = 2n ** BigInt(e);
      paintPreservingFocus();
      return;
    }

    if (el.id === 'n-select') {
      resize(Number((el as HTMLSelectElement).value));
      paintPreservingFocus();
      return;
    }

    const which = (el as HTMLInputElement).dataset.vec;
    if (which === 'x' || which === 'y') {
      const idx = Number((el as HTMLInputElement).dataset.index);
      const val = clampEntry((el as HTMLInputElement).value, ENTRY_MIN, ENTRY_MAX);
      if (which === 'x') {
        state.x[idx] = val;
        // x changed, so the ciphertext must be rebuilt: it encrypts x.
        reencrypt(state);
      } else {
        state.y[idx] = val;
      }
      paintPreservingFocus();
    }
  });
}

function boot(): void {
  wireTabs();
  wirePanelEvents();
  selectTab('keys', false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

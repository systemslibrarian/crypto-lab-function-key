import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the one rendering a reduced-motion reader actually gets — `.panel` and
 *     `.reveal` with their animations cancelled by the stylesheet's own rule —
 *     was never once the rendering that got scanned. This gate sets the
 *     preference through `emulateMedia`, asserts from inside the page that it
 *     took effect (`test.use({ reducedMotion })` silently does nothing on
 *     Playwright 1.61.1), and injects nothing.
 *
 *  2. IT FORCED EVERY PANEL VISIBLE FROM SCRIPT. The old drive stripped every
 *     `[hidden]` attribute and set every `<details>.open` by JS before its only
 *     scan. Stripping `hidden` puts all six tabpanels on screen AT ONCE — a
 *     rendering no reader can reach and axe then scans instead of the real one
 *     — and script-opening the disclosures means the SHUT state, which is what
 *     every reader arrives at, was never scanned at all. This gate switches
 *     tabs by clicking them and opens each disclosure through its `<summary>`,
 *     which is the route a reader has, and scans before and after.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked
 *     every button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed 120ms per tab, and scanned ONCE at the
 *     end — so in a lab shaped like this one the out-of-range branch, the
 *     rank-deficient refusal, the recovered-master alarm and the failing
 *     fixture row would all have been overwritten before anything measured
 *     them, and a click that silently did nothing would look identical to one
 *     that worked. This drive names every control it touches, asserts a real
 *     completion signal after each, and scans after every step, at 1280 and
 *     380 in the one theme this fleet ships.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning are `color-mix()` fills axe files under `incomplete`
 *     rather than judging: the alarm-tinted row fill that marks the
 *     deliberately wrong fixture and every out-of-range boundary row, and
 *     `.btn-primary:hover`. Every accent surface is a second case, because
 *     `--accent` is deliberately undefined here and resolves through a
 *     `var(--accent, #35d6bb)` fallback chain axe has no reason to follow. So
 *     is an `aria-label` on a role-less element.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The old
 *     spec hand-rolled one luminance check over two input selectors, reading
 *     the DECLARED `border-top-color` and `background-color` — blind to
 *     `color-mix()`, to composited backdrops, to every `.btn`, `.tab-btn`,
 *     `.dim-cell` and `.swatch` control, and to all states past first paint.
 *     `nontext.ts` replaces it with a measured oracle over every control at
 *     every driven state, and `expectNoHorizontalOverflow` adds the 1.4.10
 *     check axe has no rule for.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `styles.css`'s reduced-motion
 * block cancels every transition, and this lab declares no animation at all —
 * decorative motion is banned and nothing here is animated — so
 * `getAnimations()` is normally empty and this returns on the sixth frame. It
 * stays because the shared top bar's `.cl-btn` transitions are declared
 * OUTSIDE the lab's `@media` block — `* { transition: none !important }` wins
 * today, but that is a property of the current stylesheet, not of the page.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * has EXACTLY that shape in miniature: `@keyframes fade` and `@keyframes
 * reveal` both start `from { opacity: 0 }`, and every tab panel and every
 * stepper line rides one of them. The reduced-motion block cancels both with
 * `animation: none`, which restores the static `opacity: 1` — correct today,
 * and this assertion is what makes that a measurement rather than a reading.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is decorative
 * verdict/pill glyphs beside their own words — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Every panel here renders synchronously at first activation, so a
 * renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. Attach before `boot`,
 * assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies
 * a second banner today — but the shared bar's `dedupeBanner()` exists because
 * other labs in this fleet DID ship one, and the hero markup is the part of
 * this page most likely to be re-templated from a lab that uses `<header>`.
 * Asserting the OUTCOME rather than the markup is what catches that edit.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab's one list is the Verify Workbench pipeline: `ol.stage-list` styled
 * `list-style: none`, which is exactly the declaration that makes Safari and
 * VoiceOver DROP the list's implicit role. `verifyWorkbench.ts` compensates
 * the documented way — an explicit `role="list"` on the `<ol>` and
 * `role="listitem"` on every `.stage` — so here, unlike most of this fleet, an
 * explicit role on a list is the fix rather than the defect. What is asserted
 * is therefore the SHAPE of that fix: any explicit role on a `ul`/`ol` must be
 * `list` (any other value orphans every `<li>` under it), and a `role="list"`
 * must never sit on an empty element, because axe applies
 * `aria-required-children` to the explicit role and fails it the day the
 * pipeline renders with no stages. Roles can be assigned as JS properties in
 * an element-creation helper, so ask the DOM rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

/**
 * Navigate, pin the theme, and assert the page really rendered.
 *
 * Reduced motion is emulated BEFORE navigation and then asserted in-page,
 * because `test.use({ reducedMotion })` and the `reducedMotion` config key are
 * measured no-ops on Playwright 1.61.x, and because injecting a
 * motion-suppressing stylesheet would bypass this lab's own
 * `prefers-reduced-motion` block instead of exercising it.
 *
 * The theme is seeded through `localStorage` rather than by clicking a toggle:
 * `index.html`'s anti-flash script writes and reads the `theme` key, and this
 * boot fails on `data-theme` if that ever drifts.
 *
 * The defaults are asserted at length because `main.ts` renders each tabpanel
 * lazily on first activation. A navigation that resolves proves nothing: a
 * renderer that threw would leave `#panel-keys` empty, and an EMPTY REGION IS
 * EXACTLY WHAT A SCAN REPORTS AS PERFECTLY ACCESSIBLE. Everything asserted
 * here is a value this lab ships, so an assertion failing is a change in the
 * lab, not a flaky wait.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('.tab-btn')).toHaveCount(8);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Function Key');

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme, so the page must carry no theme control at all.
  // The shared CSS hides any lab toggle with `display:none !important`, which
  // would leave a dead-but-known element; asserting the count at zero catches
  // the day one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);

  // ── --accent is deliberately UNDEFINED in this repo ─────────────────────
  // Central assignment owns it. Asserting that here means the gate is known to
  // be measuring the `var(--accent, #35d6bb)` fallback rather than an assigned
  // colour — so if a later run reports a control-boundary failure on
  // `.btn-primary` or the selected tab, the first question ("did the accent
  // land?") already has an answer on the record.
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    ),
    '--accent must stay undefined in this repo; the catalog assigns it centrally'
  ).toBe('');

  // ── The arrival state: exhibit 1 active and already computed ────────────
  // `renderKeys` runs a real Setup, Encrypt, KeyDer and Decrypt at mount, so
  // first paint carries a recovered integer and a correctness verdict. The
  // other seven panels are lazily rendered: hidden AND EMPTY until their tab
  // is first activated — asserted, because "empty" is this lab's tell that a
  // renderer threw (see `watchPageErrors`).
  await expect(page.locator('#panel-keys [data-verdict="correctness"]')).toContainText(
    'MATCHES THE DOT PRODUCT'
  );
  await expect(page.locator('#panel-keys .recovered-int')).toHaveText('15');
  for (const id of ['decrypt', 'bottleneck', 'collect', 'alone', 'fixtures', 'compare', 'honesty']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).toBeEmpty();
  }

  // ── Every shipped control default ───────────────────────────────────────
  // x = (3,1,4,1), y = (2,0,1,5), so <x,y> = 15 — the value asserted above.
  for (const [i, v] of ['3', '1', '4', '1'].entries()) {
    await expect(page.locator(`input[data-vec="x"][data-index="${i}"]`)).toHaveValue(v);
  }
  for (const [i, v] of ['2', '0', '1', '5'].entries()) {
    await expect(page.locator(`input[data-vec="y"][data-index="${i}"]`)).toHaveValue(v);
  }
  await expect(page.locator('#n-select')).toHaveValue('4');

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all. This lab's long
 * values are 64-byte hex runs — every `.field-value` and `.eq-derivation`
 * relies on `overflow-wrap: anywhere` instead of a scroll region, and the
 * `.sig-pair` grid collapses to one column at 640px — so the shapes at risk
 * are a new unwrapped `<code>` run or a grid item whose automatic minimum size
 * is the min-content of a 128-char line. At 380px that is precisely what this
 * check exists to catch.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab currently avoids scrollers on purpose — long hex wraps via
 * `overflow-wrap: anywhere` — so the assertion is usually vacuous here. It
 * runs at every state anyway, because the requirement MATERIALISES the moment
 * someone reaches for `overflow-x: auto` on a wide value or table (the
 * stylesheet already carries an unused `.table-wrap` rule inviting exactly
 * that), and a scroller born without a keyboard route is invisible to axe.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because the surfaces carrying
 *    this lab's meaning are fills axe cannot resolve: the alarm-tinted
 *    `color-mix()` row fill on the wrong fixture and the out-of-range boundary
 *    rows, `.btn-primary:hover`, and every accent surface, which resolves
 *    through the `var(--accent, #35d6bb)` fallback this repo relies on while
 *    `--accent` stays centrally assigned. Everything else in that bucket is a
 *    real result axe simply could not finish — including
 *    `aria-prohibited-attr`, which is where an `aria-label` on a role-less
 *    element hides. This page leans on getting that right: each vector's
 *    `.vec-inputs` wrapper pairs its label with `role="group"` via
 *    `aria-labelledby`, and every table scroller is a `role="region"` with an
 *    `aria-label`. Drop any of those roles and the label is silently
 *    discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, two `<nav>`s
  // (the shared actions and the tablist wrapper), one `<main>` and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/** Switch to a tab by clicking it, and prove the switch happened. */
async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/**
 * Drive the lab through every state it teaches, scanning each one.
 *
 * Why a drive rather than one scan of the arrival page:
 *
 *  - EVERY PANEL IS RENDERED LAZILY, so a tab that is never clicked is a panel
 *    that is never even IN the DOM. Each of the eight is activated through its
 *    real tab button and scanned in its own driven states.
 *
 *  - THE TWO EXHIBITS THAT MATTER MOST ARE MULTI-STATE BY CONSTRUCTION.
 *    Exhibit 4 paints a different thing at every rank — an affine family at
 *    rank < n, a single recovered point at rank n — and exhibit 5 paints a
 *    refusal at rank < n and an alarm-styled recovery at rank n. The recovery
 *    state contains the `.alarm-box` treatment that exists nowhere else on the
 *    page, so a gate that never collects four keys never scans it.
 *
 *  - FAILURE AND REFUSAL STATES ARE THE POINT OF THIS LAB, not incidental.
 *    The out-of-range decrypt paints `.pending-int` instead of
 *    `.recovered-int`; the fixtures table paints a failing row with a
 *    `color-mix()` tint; the boundary table paints two of each. None is
 *    reachable without driving the lab into them on purpose.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, and
 *    `.tab-btn:hover`, `.btn:hover` and `.btn-primary:hover` all repaint their
 *    fill — the last one through a `color-mix()` toward white that axe will
 *    not resolve. Scanned explicitly.
 *
 *  - THE CHART IS SVG WITH REAL TEXT. Exhibit 3's axis and tick labels are
 *    `<text>` in an inline SVG over a panel fill, and its gridlines are
 *    stroke-only `<line>`. That is the shape `contrast.ts`'s `FILLED` guard
 *    exists for, so it is scanned at both ends of the bound slider.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: a
 *    verdict's wording, a rank readout, `aria-selected`, an element count.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);
  const tab = (name: RegExp) => page.getByRole('tab', { name });

  await scanAt('arrival: exhibit 1 computed, seven panels unrendered');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── 1 · Two kinds of key ────────────────────────────────────────────────
  // Push the inner product out of the default bound so the analyst column
  // paints `.pending-int` — the "no answer" treatment — instead of an integer.
  await page.locator('input[data-vec="y"][data-index="0"]').fill('9');
  await page.locator('input[data-vec="x"][data-index="0"]').fill('9');
  await page.locator('input[data-vec="y"][data-index="1"]').fill('9');
  await page.locator('input[data-vec="x"][data-index="1"]').fill('9');
  await expect(page.locator('#panel-keys [data-verdict="correctness"]')).toContainText(
    'MATCHES THE DOT PRODUCT'
  );
  await scanAt('1: larger entries, still inside the bound');

  // A negative inner product: the symmetric range is what finds it. Both of
  // the first two x components are negated, so with y = (9,9,1,5) and
  // x = (-9,-9,4,1) the product is -81-81+4+5 = -153. Negating only the first
  // leaves +9, which is how this step originally passed while testing nothing
  // — the assertion below names the exact value for that reason.
  await page.locator('input[data-vec="x"][data-index="0"]').fill('-9');
  await page.locator('input[data-vec="x"][data-index="1"]').fill('-9');
  await expect(page.locator('#panel-keys .recovered-int')).toHaveText('-153');
  await scanAt('1: negative inner product recovered');

  await page.getByRole('button', { name: 'Encrypt again' }).click();
  await expect(page.locator('#panel-keys [data-verdict="correctness"]')).toContainText(
    'MATCHES THE DOT PRODUCT'
  );
  await scanAt('1: re-encrypted under fresh randomness, same answer');

  await page.getByRole('button', { name: 'New master key' }).click();
  await expect(page.locator('#panel-keys [data-verdict="correctness"]')).toContainText(
    'MATCHES THE DOT PRODUCT'
  );
  await scanAt('1: new master key, same answer');

  // n = 8 is the cap, and it is the widest the control row ever gets — the
  // shape most likely to overflow at 380px.
  await page.locator('#n-select').selectOption('8');
  await expect(page.locator('input[data-vec="x"]')).toHaveCount(8);
  await scanAt('1: dimension at the cap, n = 8, sixteen vector inputs');

  // A focused number input, showing its focus-visible ring on a control whose
  // boundary is `--control-border`.
  await page.locator('input[data-vec="x"][data-index="0"]').focus();
  await scanAt('1: a vector input focused');

  await page.locator('#n-select').selectOption('4');
  await expect(page.locator('input[data-vec="x"]')).toHaveCount(4);

  // A styled <select> focused: `appearance: none` plus the gradient chevron.
  await page.locator('#n-select').focus();
  await scanAt('1: the dimension select focused');

  // ── 2 · Decrypt ─────────────────────────────────────────────────────────
  await openTab(page, /Decrypt/, '#panel-decrypt');
  // The combined element, plus the five ciphertext components the panel now
  // shows for invariant 2 — six `.group-el` boxes, one of which is the answer.
  await expect(page.locator('#panel-decrypt [data-field="element"]')).toHaveCount(1);
  await expect(page.locator('#panel-decrypt .group-el')).toHaveCount(6);
  // The randomized-encryption verdict already has something to compare here:
  // the exhibit-1 steps above edited x, and editing x re-encrypts. The
  // no-previous-ciphertext state (tone `info`) exists only on a fresh page and
  // is covered by the claims suite instead.
  await expect(page.locator('#panel-decrypt [data-verdict="randomized"]')).toHaveAttribute(
    'data-tone',
    'ok'
  );
  await expect(page.locator('#panel-decrypt [data-verdict="decrypt-exact"]')).toContainText(
    'EXPONENT RECOVERED EXACTLY'
  );
  await scanAt('2: opaque group element above the recovered integer');

  // Re-encrypt so the componentwise comparison has something to report: five
  // per-component verdicts plus the summary, a state that does not exist on
  // arrival.
  await openTab(page, /Two kinds/, '#panel-keys');
  await page.getByRole('button', { name: 'Encrypt again' }).click();
  await openTab(page, /Decrypt/, '#panel-decrypt');
  await expect(page.locator('#panel-decrypt [data-verdict="randomized"]')).toContainText(
    'EVERY COMPONENT CHANGED'
  );
  await expect(page.locator('#panel-decrypt [data-verdict^="component-"]')).toHaveCount(5);
  await scanAt('2: ciphertext compared componentwise against the previous encryption');

  // ── 3 · The bottleneck ──────────────────────────────────────────────────
  //
  // Exhibit 3 comes before exhibit 2's failure branch on purpose, because at
  // the DEFAULT bound that branch is unreachable: with n <= 8 and entries in
  // [-9, 9] the largest inner product this lab can produce is 8*9*9 = 648, and
  // the default B is 1024. No legal input goes out of range at the default,
  // which is a property worth having (the shipped default cannot fail) and
  // means the only honest route to the refusal is to lower B under the current
  // answer. That is what a reader does, so it is what the drive does.
  await openTab(page, /bottleneck/, '#panel-bottleneck');
  await expect(page.locator('#panel-bottleneck svg')).toHaveCount(1);
  await expect(page.locator('#panel-bottleneck [data-verdict="cost-law"]')).toContainText(
    'SQUARE-ROOT SCALING HOLDS'
  );
  await expect(page.locator('#panel-bottleneck [data-verdict="range-edge"]')).toContainText(
    'SYMMETRIC RANGE'
  );
  // Two of the four boundary rows are the out-of-range cases, painted with the
  // alarm-tinted `color-mix()` row fill.
  await expect(page.locator('#panel-bottleneck tr[data-row-state="pass"]')).toHaveCount(4);
  await scanAt('3: cost chart, cost-law verdict and the four boundary rows');

  // Both ends of the slider: the chart re-renders and the readout is a live
  // region, so this also scans `role="status"` content mid-life.
  await page.locator('#bound-slider').fill('3');
  await expect(page.locator('#bound-readout')).toContainText('B = 8;');
  await scanAt('3: bound slider at its minimum');

  await page.locator('#bound-slider').fill('21');
  await expect(page.locator('#bound-readout')).toContainText('B = 2097152;');
  await scanAt('3: bound slider at the measured cap');

  await page.locator('#bound-slider').focus();
  await scanAt('3: the bound slider focused');

  // Drop the bound under the current answer (-153, from exhibit 1) so the
  // search genuinely fails: B = 8 at the slider's minimum. The integer is then
  // not rendered at all — `.pending-int` replaces it — which is the rule that
  // a value never appears before the search finishes.
  await page.locator('#bound-slider').fill('3');
  await expect(page.locator('#bound-readout')).toContainText('B = 8;');
  await openTab(page, /Decrypt/, '#panel-decrypt');
  await expect(page.locator('#panel-decrypt [data-verdict="range-search"]')).toContainText(
    'SEARCH EXHAUSTED'
  );
  await expect(page.locator('#panel-decrypt .pending-int')).toHaveCount(1);
  await expect(page.locator('#panel-decrypt .recovered-int')).toHaveCount(0);
  await scanAt('2: out of range — no integer rendered, only the exhausted-search verdict');

  // Widening the bound brings the same product back into reach, which is the
  // interaction the pair of exhibits exists to make.
  await openTab(page, /bottleneck/, '#panel-bottleneck');
  await page.locator('#bound-slider').fill('11');
  await expect(page.locator('#bound-readout')).toContainText('B = 2048;');
  await openTab(page, /Decrypt/, '#panel-decrypt');
  await expect(page.locator('#panel-decrypt .recovered-int')).toHaveText('-153');
  await scanAt('2: the same product now recovered, after widening B');

  // ── 4 · Collect keys ────────────────────────────────────────────────────
  await openTab(page, /Collect keys/, '#panel-collect');
  await expect(page.locator('#panel-collect [data-verdict="partial"]')).toContainText(
    '4 FREE DIMENSIONS REMAIN'
  );
  await scanAt('4: no keys held — every x still possible');

  const requestKey = async (n: number) => {
    await page.locator('#panel-collect button[data-request-key]').first().click();
    await expect(page.locator('#panel-collect [data-verdict^="offer-"]')).toHaveCount(n);
  };

  await requestKey(1);
  await expect(page.locator('#panel-collect [data-verdict="partial"]')).toContainText(
    '3 FREE DIMENSIONS REMAIN'
  );
  // The evidence fixture: both candidate vectors still consistent.
  await expect(page.locator('#panel-collect [data-verdict="two-candidates"]')).toContainText(
    'BOTH REMAIN CONSISTENT'
  );
  await scanAt('4: one key held — the affine family, both candidates alive');

  await requestKey(2);
  await expect(page.locator('#panel-collect [data-verdict="partial"]')).toContainText(
    '2 FREE DIMENSIONS REMAIN'
  );
  await expect(page.locator('#panel-collect [data-verdict="two-candidates"]')).toContainText(
    'BOTH REMAIN CONSISTENT'
  );
  await scanAt('4: two keys held — dimension 2, still no single x drawn');

  await requestKey(3);
  await scanAt('4: three keys held — dimension 1');

  await requestKey(4);
  await expect(page.locator('#panel-collect [data-verdict="partial"]')).toContainText(
    'x IS NOW DETERMINED'
  );
  await expect(page.locator('#panel-collect [data-verdict="reconstruct"]')).toContainText(
    'x RECOVERED EXACTLY'
  );
  await scanAt('4: full rank — x pinned to one point and reconstructed exactly');

  await page.getByRole('button', { name: 'Return all keys' }).click();
  await expect(page.locator('#panel-collect [data-verdict="partial"]')).toContainText(
    '4 FREE DIMENSIONS REMAIN'
  );
  await scanAt('4: keys returned — the panel is back to knowing nothing');

  // ── 5 · Keys alone ──────────────────────────────────────────────────────
  await openTab(page, /Keys alone/, '#panel-alone');
  await expect(page.locator('#panel-alone [data-verdict="rank-refusal"]')).toContainText(
    'RANK 0 OF 4'
  );
  await scanAt('5: no keys collected');

  const collectAlone = async (n: number) => {
    await page.locator('#panel-alone button[data-request-alone]').first().click();
    await expect(page.locator('#panel-alone [data-verdict^="alone-offer-"]')).toHaveCount(n);
  };

  // The first four offers are rank-deficient by construction — a scalar
  // multiple and an exact duplicate — so four keys still means refusal.
  for (let i = 1; i <= 4; i++) await collectAlone(i);
  await expect(page.locator('#panel-alone [data-verdict="rank-refusal"]')).toContainText(
    'RANK 2 OF 4 — RECOVERY REFUSED'
  );
  await expect(page.locator('#panel-alone .alarm-box')).toHaveCount(0);
  await scanAt('5: four dependent keys held — rank 2, recovery refused, no s shown');

  await collectAlone(5);
  await collectAlone(6);
  await expect(page.locator('#panel-alone [data-verdict="rank-refusal"]')).toContainText(
    's RECOVERED'
  );
  await expect(page.locator('#panel-alone [data-verdict="master"]')).toContainText(
    'FORGED KEY DECRYPTS A FRESH CIPHERTEXT CORRECTLY'
  );
  // The alarm treatment and the "why this is permitted" scoping only exist in
  // this state.
  await expect(page.locator('#panel-alone .alarm-box')).toHaveCount(1);
  await expect(page.locator('#panel-alone [data-field="not-claimed"]')).toContainText(
    'adaptively secure'
  );
  await scanAt('5: full rank — s recovered, forged key works, alarm treatment painted');

  await page.getByRole('button', { name: 'Return all keys' }).click();
  await expect(page.locator('#panel-alone .alarm-box')).toHaveCount(0);

  // ── 6 · Fixtures ────────────────────────────────────────────────────────
  await openTab(page, /Fixtures/, '#panel-fixtures');
  await expect(page.locator('#panel-fixtures tbody tr')).toHaveCount(7);
  // Six agree, one disagrees on purpose. The failing row is painted with an
  // alarm-tinted `color-mix()` fill that only this state produces.
  await expect(page.locator('#panel-fixtures tr[data-row-state="fail"]')).toHaveCount(1);
  await expect(page.locator('#panel-fixtures tr[data-row-state="pass"]')).toHaveCount(6);
  await expect(
    page.locator('#panel-fixtures [data-verdict="wrong-fixture-detected"]')
  ).toContainText('REPORTED AS DISAGREEING');
  await scanAt('6: fixtures table with the deliberately wrong row reported failing');

  // ── 7 · Where IPFE sits ─────────────────────────────────────────────────
  await openTab(page, /Where IPFE sits/, '#panel-compare');
  await expect(page.locator('#panel-compare .compare-grid > div')).toHaveCount(3);
  await scanAt('7: the ABE / IPFE / FHE comparison panel');

  // ── 8 · Honesty ─────────────────────────────────────────────────────────
  await openTab(page, /Honesty/, '#panel-honesty');
  await expect(page.locator('#panel-honesty [data-field="negative-claim"]')).toContainText(
    'additively malleable'
  );
  await expect(
    page.locator('#panel-honesty [data-verdict="negative-claim-verdict"]')
  ).toContainText('DECRYPTED — AND MODIFIED');
  await scanAt('8: honesty panel and the malleability exhibit');

  // ── Hover states ────────────────────────────────────────────────────────
  await page.locator('a.cl-btn').first().hover();
  await scanAt('the shared bar GitHub control hovered');

  await tab(/Fixtures/).hover();
  await scanAt('an unselected tab hovered');

  await tab(/Honesty/).hover();
  await scanAt('the selected tab hovered');

  // ── Focus rings ─────────────────────────────────────────────────────────
  await tab(/Honesty/).focus();
  await scanAt('the selected tab focused');

  await openTab(page, /Two kinds/, '#panel-keys');
  await page.getByRole('button', { name: 'New master key' }).focus();
  await scanAt('a secondary button focused');
}

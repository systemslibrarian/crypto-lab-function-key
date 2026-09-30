import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches, and every one of those states
 * is scanned at desktop and at 380px:
 *
 *   the arrival state, where exhibit 1 has already run a real Setup, Encrypt,
 *   KeyDer and Decrypt and the other seven tabpanels are hidden and
 *   UNRENDERED; the shared skip link focused; the vector fields driven to
 *   larger entries, to a negative inner product, and out past the bound so the
 *   analyst column paints its no-answer treatment; a re-encryption and a fresh
 *   master key; the dimension at its cap of 8 and back; a number input and the
 *   styled select focused; exhibit 2 with the opaque group element above the
 *   recovered integer, then in the branch where the search is exhausted and NO
 *   integer is rendered at all, then recovered again after the bound is
 *   widened; exhibit 3's SVG cost chart at both ends of the bound slider, its
 *   live readout, and the four boundary rows where two of them are
 *   out-of-range refusals; exhibit 4 at every rank from 0 to 4, which is five
 *   distinct renderings — an affine family with both candidate vectors alive,
 *   then the single point it collapses to — and then reset; exhibit 5 with
 *   four dependent keys held and recovery refused, and again at full rank
 *   where the master secret is recovered and the alarm treatment appears;
 *   exhibit 6's fixture table with its deliberately-wrong row reported
 *   failing; exhibits 7 and 8; three hover states; and two focus rings.
 *
 * See `gate.ts` for why nothing is injected into the page (the old gate's
 * `addStyleTag` motion kill bypassed the stylesheet's own reduced-motion
 * block, so the rendering reduced-motion readers get was never the one
 * scanned), why no panel is revealed from script, why the lab's defaults are
 * asserted rather than assumed, and why `violations` is not the whole oracle.
 *
 * ONE THEME. Dark is the only theme in this fleet and this lab ships no
 * toggle, so the loop below runs once. It is written as a loop anyway because
 * that is the fleet's shape and collapsing it would make this file the odd one
 * out for no gain.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}

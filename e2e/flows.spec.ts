/**
 * Functional flows — one scenario per stage, driven the way a reader drives it.
 *
 * Role-based, and run at desktop and phone width. These are about whether the
 * lab WORKS: every stage reachable, every control operable by keyboard, the
 * narrative in order, and the interface responsive while the expensive search
 * is running. The claims suite checks whether the page tells the truth; this
 * checks whether it functions.
 */

import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).not.toBeEmpty();
}

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20_000);
  await page.goto('.');
  await expect(page.locator('h1')).toHaveText('Function Key');
});

test('the first interaction is above the fold, before the stage list', async ({ page }) => {
  // The review's measurement: controls used to begin ~998px down on desktop
  // and ~1893px down on a phone. The scenario bar fixes that, and this keeps
  // it fixed.
  const box = await page.locator('#scenario-host .scenario').boundingBox();
  expect(box, 'the scenario bar must be laid out').not.toBeNull();
  const viewport = page.viewportSize();
  expect(box!.y, 'the first control must be within the first viewport').toBeLessThan(
    (viewport?.height ?? 800) - 40,
  );

  // And it precedes the stage list in the DOM, so tab order reaches it first.
  const order = await page.evaluate(() => {
    const sc = document.querySelector('#scenario-host');
    const nav = document.querySelector('.stages-nav');
    return !!(sc && nav && sc.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});

test('stage 1: editing x or y updates both columns', async ({ page }) => {
  await expect(page.locator('#panel-ask [data-field="analyst-answer"]')).toHaveText('15');
  await page.locator('input[data-vec="y"][data-index="1"]').fill('3');
  // y = (2,3,1,5) against x = (3,1,4,1): 6 + 3 + 4 + 5 = 18
  await expect(page.locator('#panel-ask [data-field="analyst-answer"]')).toHaveText('18');
  // The authority column tracks x, not y.
  await page.locator('input[data-vec="x"][data-index="0"]').fill('-9');
  await expect(page.locator('#panel-ask [data-field="authority-vector"]')).toHaveText(
    '(-9, 1, 4, 1)',
  );
});

test('a vector input keeps focus while being typed into', async ({ page }) => {
  // The scenario bar re-renders on every keystroke, so focus has to be
  // restored or the field is unusable with a keyboard.
  const input = page.locator('input[data-vec="x"][data-index="2"]');
  await input.focus();
  await input.fill('7');
  await expect(input).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('input[data-vec="x"][data-index="2"]')).toBeFocused();
});

test('stage 2: the element is shown before the integer, and looks different from it', async ({
  page,
}) => {
  await open(page, /Decode the bounded/, '#panel-decode');
  await page.getByRole('button', { name: 'Apply functional key' }).click();
  await page.getByRole('button', { name: 'Recover the integer' }).click();
  await expect(page.locator('#panel-decode .recovered-int')).toHaveCount(1);

  const order = await page.evaluate(() => {
    const el = document.querySelector('#panel-decode [data-field="element"]');
    const int = document.querySelector('#panel-decode .recovered-int');
    return !!(el && int && el.compareDocumentPosition(int) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order, 'the opaque element must precede the recovered integer').toBe(true);

  const styles = await page.evaluate(() => {
    const el = getComputedStyle(document.querySelector('#panel-decode [data-field="element"]')!);
    const int = getComputedStyle(document.querySelector('#panel-decode .recovered-int')!);
    return { a: el.fontSize, b: int.fontSize, c: el.color, d: int.color };
  });
  expect(styles.a).not.toBe(styles.b);
  expect(styles.c).not.toBe(styles.d);
});

test('stage 2: the slider changes the cost and the readout stays in step', async ({ page }) => {
  await open(page, /Decode the bounded/, '#panel-decode');
  await expect(page.locator('#panel-decode [data-verdict="cost-law"]')).toHaveAttribute(
    'data-tone',
    'ok',
  );
  await expect(page.locator('#panel-decode svg')).toHaveCount(1);

  await page.locator('#bound-slider').fill('8');
  const low = await page.locator('#bound-readout').innerText();
  await page.locator('#bound-slider').fill('20');
  const high = await page.locator('#bound-readout').innerText();
  expect(low).not.toBe(high);
  expect(high).toContain('B = 1048576');
});

test('the bound slider is keyboard-operable', async ({ page }) => {
  const slider = page.locator('#bound-slider');
  await slider.focus();
  const before = await slider.inputValue();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#bound-slider')).not.toHaveValue(before);
  await expect(page.locator('#bound-slider')).toBeFocused();
});

/**
 * THE RESPONSIVENESS BUDGET.
 *
 * At B = 2^21 a worst-case search costs ~4100 group operations and took ~390ms
 * inline on the machine this was built on. Run on the main thread that is a
 * frozen interface for the whole of it, which makes the maximum setting feel
 * broken rather than expensive. The search now runs in a worker, and this
 * measures that it does: long tasks are collected while a max-bound search is
 * in flight, and the interface is exercised during it.
 */
test('at the maximum bound the interface stays responsive while searching', async ({ page }) => {
  await page.locator('#bound-slider').fill('21');
  await open(page, /Decode the bounded/, '#panel-decode');
  await page.getByRole('button', { name: 'Apply functional key' }).click();

  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__long.push(e.duration);
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      // Not every engine exposes longtask; the interaction check below still
      // runs and is the one that matters to a reader.
    }
  });

  await page.getByRole('button', { name: 'Recover the integer' }).click();

  // WHILE THE SEARCH IS IN FLIGHT the page must still take input. If the
  // search were inline this would block until it finished.
  // x = (3,1,4,1), y becomes (2,0,1,4): 6 + 0 + 4 + 4 = 14. The value named
  // here is the point — a generic "it changed" assertion would pass against a
  // page that echoed anything at all.
  await page.locator('input[data-vec="y"][data-index="3"]').fill('4');
  await expect(page.locator('[data-field="scenario-expected"]')).toHaveText('14');

  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long ?? []);
  const worst = long.length ? Math.max(...long) : 0;
  // 250ms is the budget: comfortably under the ~390ms the inline search cost,
  // and loose enough not to flake on a shared CI runner. A regression that
  // moved the search back onto the main thread would blow straight past it.
  expect(worst, `longest main-thread task ${worst.toFixed(0)}ms`).toBeLessThan(250);
});

test('stage 3: requesting keys shrinks the family to a point, then resets', async ({ page }) => {
  await open(page, /Watch knowledge/, '#panel-accumulate');
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    seen.push(await page.locator('#panel-accumulate [data-verdict="partial"]').innerText());
    await page.locator('#panel-accumulate button[data-request-key]').first().click();
    await expect(page.locator('#panel-accumulate [data-verdict^="offer-"]')).toHaveCount(i + 1);
  }
  seen.push(await page.locator('#panel-accumulate [data-verdict="partial"]').innerText());

  expect(new Set(seen).size, 'each key must change what is known').toBe(5);
  expect(seen[4]).toContain('x IS NOW DETERMINED');
  // Singular copy at one remaining dimension, not "1 dimensions".
  expect(seen[3]).toContain('1 FREE DIMENSION ');

  await page.getByRole('button', { name: 'Return all keys' }).click();
  await expect(page.locator('#panel-accumulate [data-verdict="partial"]')).toContainText(
    '4 FREE DIMENSIONS REMAIN',
  );
});

test('stage 4: the refusal precedes the recovery and the warning treatment is distinct', async ({
  page,
}) => {
  await open(page, /Cross the authorization/, '#panel-cross');
  for (let i = 0; i < 4; i++) {
    await page.locator('#panel-cross button[data-request-alone]').first().click();
    await expect(page.locator('#panel-cross [data-verdict^="alone-offer-"]')).toHaveCount(i + 1);
  }
  await expect(page.locator('#panel-cross [data-verdict="rank-refusal"]')).toContainText(
    'RECOVERY REFUSED',
  );

  for (let i = 4; i < 5; i++) {
    await page.locator('#panel-cross button[data-request-alone]').first().click();
  }
  await page.getByRole('button', { name: 'Issue it anyway' }).click();
  await page.locator('#panel-cross button[data-request-alone]').first().click();
  await expect(page.locator('#panel-cross .alarm-box').first()).toBeVisible();

  const distinct = await page.evaluate(() => {
    const alarm = getComputedStyle(document.querySelector('#panel-cross .alarm-box')!);
    const card = getComputedStyle(document.querySelector('#panel-cross .card')!);
    return alarm.borderLeftColor !== card.borderLeftColor;
  });
  expect(distinct, 'the keys-alone act needs a distinct warning treatment').toBe(true);
});

test('evidence: fixtures, comparison and honesty are all present', async ({ page }) => {
  await open(page, /Evidence/, '#panel-evidence');
  const panel = page.locator('#panel-evidence');
  await expect(panel.locator('tbody tr[data-fixture]')).toHaveCount(7);
  await expect(panel).toContainText('whether');
  await expect(panel).toContainText('which function');
  await expect(panel).toContainText('without learning');
  await expect(panel.locator('a[href*="attribute-gate"]')).toHaveCount(1);
  await expect(panel).toContainText('FAME CP-ABE');
  await expect(panel).toContainText('Real');
  await expect(panel).toContainText('Modeled');
  await expect(panel).toContainText('Not implemented');
  await expect(panel).toContainText(/not production/i);
});

test('every stage is reachable by keyboard alone, with arrow keys', async ({ page }) => {
  await page.getByRole('tab', { name: /Ask one question/ }).focus();
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    const active = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-controls') ?? '',
    );
    seen.push(active);
    await expect(page.locator(`#${active}`)).not.toBeEmpty();
    await page.keyboard.press('ArrowRight');
  }
  expect(new Set(seen).size, 'arrow keys must reach all five panels').toBe(5);

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Evidence/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: /Ask one question/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('disclosures are operable by keyboard and reveal their bodies', async ({ page }) => {
  const summary = page.locator('#panel-ask details.disclose > summary').first();
  await expect(page.locator('#panel-ask details.disclose[open]')).toHaveCount(0);
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel-ask details.disclose[open]')).toHaveCount(1);
  await expect(page.locator('#panel-ask [data-field="sk"]')).toBeVisible();
});

test('the scripture footer is present exactly once, verbatim', async ({ page }) => {
  const footer = page.locator('footer.scripture-footer');
  await expect(footer).toHaveCount(1);
  await expect(footer).toContainText(
    'So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31',
  );
});

/**
 * LAYOUT REGRESSION, at three widths.
 *
 * Deliberately NOT pixel screenshots. `toHaveScreenshot` baselines are
 * platform-specific: generated on macOS locally they fail on the Linux CI
 * runner over font rasterization alone, and the usual fix — a large pixel
 * tolerance, or regenerating on CI — turns the check into one that cannot
 * fail for the reasons it exists for. What is asserted instead is what a
 * pixel diff would actually be protecting: nothing overflows, the first
 * interaction stays reachable, and every stage still renders.
 */
for (const [label, width, height] of [
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
] as const) {
  test(`layout holds at ${label} (${width}px): no overflow on any stage`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('.');

    const stages: [RegExp, string][] = [
      [/Ask one question/, '#panel-ask'],
      [/Decode the bounded/, '#panel-decode'],
      [/Watch knowledge/, '#panel-accumulate'],
      [/Cross the authorization/, '#panel-cross'],
      [/Evidence/, '#panel-evidence'],
    ];

    for (const [name, id] of stages) {
      await open(page, name, id);
      // Open every disclosure too: a table revealed inside one is the shape
      // most likely to overflow, and it is the shape a pixel diff would catch.
      for (;;) {
        const s = page.locator(`${id} details.disclose:not([open]) > summary`).first();
        if ((await s.count()) === 0) break;
        await s.click();
      }
      const overflow = await page.evaluate(() => {
        const d = document.documentElement;
        return d.scrollWidth - d.clientWidth;
      });
      expect(overflow, `${id} must not force horizontal scrolling at ${width}px`).toBeLessThanOrEqual(
        0,
      );
    }

    // The scenario bar is still the first thing, and still usable.
    await expect(page.locator('#scenario-host .scenario')).toBeVisible();
    await expect(page.locator('input[data-vec="x"][data-index="0"]')).toBeVisible();
  });
}

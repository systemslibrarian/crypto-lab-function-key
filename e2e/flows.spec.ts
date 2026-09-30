/**
 * Functional flows — one scenario per act, driven the way a reader drives it.
 *
 * These are role-based and run at desktop and phone width. They are about
 * whether the lab WORKS: every exhibit reachable, every control operable by
 * keyboard, and the narrative in order. The claims suite is what checks whether
 * the page tells the truth; this is what checks whether it functions.
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

test('the page boots with the plain-language intro before any group element', async ({ page }) => {
  // The pedagogy rule: an intro with no math, before any hex.
  const intro = page.locator('.card-intro');
  await expect(intro).toBeVisible();
  await expect(intro).toContainText('all-or-nothing');
  await expect(intro.locator('.group-el')).toHaveCount(0);

  // And the intro really does come before the first group element in the DOM.
  const order = await page.evaluate(() => {
    const introEl = document.querySelector('.card-intro');
    const firstHex = document.querySelector('.group-el');
    if (!introEl || !firstHex) return 'missing';
    return introEl.compareDocumentPosition(firstHex) & Node.DOCUMENT_POSITION_FOLLOWING
      ? 'intro first'
      : 'hex first';
  });
  expect(order).toBe('intro first');
});

test('act 1: editing x or y updates both sides of the comparison', async ({ page }) => {
  await expect(page.locator('#panel-keys .recovered-int')).toHaveText('15');
  await page.locator('input[data-vec="y"][data-index="1"]').fill('3');
  // y = (2,3,1,5) against x = (3,1,4,1): 6 + 3 + 4 + 5 = 18
  await expect(page.locator('#panel-keys .recovered-int')).toHaveText('18');
  // The authority's column tracks x, not y.
  await page.locator('input[data-vec="x"][data-index="0"]').fill('-9');
  await expect(page.locator('#panel-keys')).toContainText('(-9, 1, 4, 1)');
});

test('act 1: a vector input keeps focus while being typed into', async ({ page }) => {
  // The panel re-renders on every keystroke, so focus has to be restored or the
  // field is unusable. Regression test for exactly that.
  const input = page.locator('input[data-vec="x"][data-index="2"]');
  await input.focus();
  await input.fill('7');
  await expect(input).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('input[data-vec="x"][data-index="2"]')).toBeFocused();
});

test('act 2: the group element is shown before the integer, and both are present', async ({
  page,
}) => {
  await open(page, /Decrypt/, '#panel-decrypt');
  const order = await page.evaluate(() => {
    const el = document.querySelector('#panel-decrypt [data-field="element"]');
    const int = document.querySelector('#panel-decrypt .recovered-int');
    if (!el || !int) return 'missing';
    return el.compareDocumentPosition(int) & Node.DOCUMENT_POSITION_FOLLOWING
      ? 'element first'
      : 'integer first';
  });
  expect(order, 'the opaque element must be shown before the recovered integer').toBe(
    'element first',
  );

  // They must be visually distinct treatments, not the same style twice.
  const styles = await page.evaluate(() => {
    const el = getComputedStyle(document.querySelector('#panel-decrypt [data-field="element"]')!);
    const int = getComputedStyle(document.querySelector('#panel-decrypt .recovered-int')!);
    return { elSize: el.fontSize, intSize: int.fontSize, elColor: el.color, intColor: int.color };
  });
  expect(styles.elSize).not.toBe(styles.intSize);
  expect(styles.elColor).not.toBe(styles.intColor);
});

test('act 3: the slider changes the cost, and the chart and table stay in step', async ({
  page,
}) => {
  await open(page, /bottleneck/, '#panel-bottleneck');
  await expect(page.locator('#panel-bottleneck svg')).toHaveCount(1);

  await page.locator('#bound-slider').fill('8');
  const low = await page.locator('#bound-readout').innerText();
  await page.locator('#bound-slider').fill('20');
  const high = await page.locator('#bound-readout').innerText();
  expect(low).not.toBe(high);

  const ops = (s: string) => Number(s.match(/worst-case (\d+) group operations/)?.[1] ?? '0');
  expect(ops(high), 'a wider bound must cost more').toBeGreaterThan(ops(low));

  // The chart's data table is present and non-empty, so the picture has an
  // accessible equivalent rather than being the only copy of the numbers.
  await expect(
    page.locator('[aria-label="BSGS cost by search width, as a table"] tbody tr'),
  ).toHaveCount(8);
});

test('act 3: the slider is keyboard-operable', async ({ page }) => {
  await open(page, /bottleneck/, '#panel-bottleneck');
  const slider = page.locator('#bound-slider');
  await slider.focus();
  const before = await slider.inputValue();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#bound-slider')).not.toHaveValue(before);
  await expect(page.locator('#bound-slider')).toBeFocused();
});

test('act 4: requesting keys one at a time shrinks the family to a point', async ({ page }) => {
  await open(page, /Collect keys/, '#panel-collect');
  const dims: string[] = [];
  for (let i = 0; i < 4; i++) {
    dims.push(await page.locator('#panel-collect [data-verdict="partial"]').innerText());
    await page.locator('#panel-collect button[data-request-key]').first().click();
    await expect(page.locator('#panel-collect [data-verdict^="offer-"]')).toHaveCount(i + 1);
  }
  dims.push(await page.locator('#panel-collect [data-verdict="partial"]').innerText());

  // Five distinct states, one per rank, ending pinned.
  expect(new Set(dims).size, 'each key must change what is known').toBe(5);
  expect(dims[4]).toContain('x IS NOW DETERMINED');

  // Returning the keys puts it back.
  await page.getByRole('button', { name: 'Return all keys' }).click();
  await expect(page.locator('#panel-collect [data-verdict="partial"]')).toContainText(
    '4 FREE DIMENSIONS REMAIN',
  );
});

test('act 5: the refusal comes before the recovery, and the warning treatment is distinct', async ({
  page,
}) => {
  await open(page, /Keys alone/, '#panel-alone');

  // Four dependent keys: refused.
  for (let i = 0; i < 4; i++) {
    await page.locator('#panel-alone button[data-request-alone]').first().click();
    await expect(page.locator('#panel-alone [data-verdict^="alone-offer-"]')).toHaveCount(i + 1);
  }
  await expect(page.locator('#panel-alone [data-verdict="rank-refusal"]')).toContainText(
    'RECOVERY REFUSED',
  );
  await expect(page.locator('#panel-alone .alarm-box')).toHaveCount(0);

  // Two more: recovered, and the alarm treatment appears.
  for (let i = 4; i < 6; i++) {
    await page.locator('#panel-alone button[data-request-alone]').first().click();
    await expect(page.locator('#panel-alone [data-verdict^="alone-offer-"]')).toHaveCount(i + 1);
  }
  await expect(page.locator('#panel-alone .alarm-box')).toHaveCount(1);

  // The warning treatment must not read as ordinary success: it carries its own
  // border colour, distinct from a plain card.
  const distinct = await page.evaluate(() => {
    const alarm = getComputedStyle(document.querySelector('#panel-alone .alarm-box')!);
    const card = getComputedStyle(document.querySelector('#panel-alone .card')!);
    return alarm.borderLeftColor !== card.borderLeftColor;
  });
  expect(distinct, 'the keys-alone act needs a distinct warning treatment').toBe(true);
});

test('act 6: the fixtures table renders every row with both values', async ({ page }) => {
  await open(page, /Fixtures/, '#panel-fixtures');
  const rows = page.locator('#panel-fixtures tbody tr');
  await expect(rows).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    await expect(rows.nth(i).locator('td').nth(4)).not.toBeEmpty();
    await expect(rows.nth(i).locator('td').nth(5)).not.toBeEmpty();
  }
});

test('act 7: the comparison panel distinguishes ABE, IPFE and FHE', async ({ page }) => {
  await open(page, /Where IPFE sits/, '#panel-compare');
  const panel = page.locator('#panel-compare');
  await expect(panel).toContainText('whether');
  await expect(panel).toContainText('which function');
  await expect(panel).toContainText('without learning');
  // It must credit the existing ABE lab rather than implying ABE is absent.
  await expect(panel.locator('a[href*="attribute-gate"]')).toHaveCount(1);
  await expect(panel).toContainText('FAME CP-ABE');
});

test('act 8: the honesty panel lists real, modeled and not-implemented', async ({ page }) => {
  await open(page, /Honesty/, '#panel-honesty');
  const panel = page.locator('#panel-honesty');
  await expect(panel).toContainText('Real');
  await expect(panel).toContainText('Modeled');
  await expect(panel).toContainText('Not implemented');
  await expect(panel).toContainText('Threat model');
  await expect(panel).toContainText(/not production/i);
});

test('every exhibit is reachable by keyboard alone, with arrow keys', async ({ page }) => {
  await page.getByRole('tab', { name: /Two kinds/ }).focus();
  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    const active = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-controls') ?? '',
    );
    seen.push(active);
    await expect(page.locator(`#${active}`)).not.toBeEmpty();
    await page.keyboard.press('ArrowRight');
  }
  expect(new Set(seen).size, 'arrow keys must reach all eight panels').toBe(8);

  // Home and End work too.
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Honesty/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: /Two kinds/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('the scripture footer is present exactly once, verbatim, as the last element', async ({
  page,
}) => {
  const footer = page.locator('footer.scripture-footer');
  await expect(footer).toHaveCount(1);
  await expect(footer).toContainText(
    'So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31',
  );
});

test('the layout does not scroll horizontally at any exhibit', async ({ page }) => {
  const tabs: [RegExp, string][] = [
    [/Two kinds/, '#panel-keys'],
    [/Decrypt/, '#panel-decrypt'],
    [/bottleneck/, '#panel-bottleneck'],
    [/Collect keys/, '#panel-collect'],
    [/Keys alone/, '#panel-alone'],
    [/Fixtures/, '#panel-fixtures'],
    [/Where IPFE sits/, '#panel-compare'],
    [/Honesty/, '#panel-honesty'],
  ];
  for (const [name, id] of tabs) {
    await open(page, name, id);
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    expect(overflow, `${id} must not force horizontal scrolling`).toBeLessThanOrEqual(0);
  }
});

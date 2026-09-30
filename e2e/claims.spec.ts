/**
 * THE CLAIMS SUITE — does the page tell the truth?
 *
 * The rule that makes these tests worth anything: compare two values the page
 * itself printed, or recompute the claim from the page's raw inputs BY A
 * DIFFERENT ROUTE than the source takes. A test that re-derives the same
 * expression the source uses will happily agree with a bug in it.
 *
 * So the workhorse here is `dotProduct` below — a plain integer loop over the
 * x and y values read out of the page's own input fields. The page reaches its
 * answer the long way round: exponentiate into ristretto255, combine the
 * ciphertext components, divide out ct_0, then search for the exponent with
 * baby-step giant-step. The test just multiplies and adds. Those are genuinely
 * independent routes to the same number, which is what lets this suite catch a
 * corrupted scheme rather than merely a page that disagrees with itself.
 *
 * Nothing in this file imports from `src/`. Every expectation is either
 * arithmetic done here or a comparison between two surfaces the page rendered.
 *
 * Covers invariants 1-9 from the brief, the section 4.1d negative claim with
 * its three required assertions, the `[hidden]` probe, a retirement check and
 * a no-op guard.
 */

import { expect, test, type Page } from '@playwright/test';

/* ------------------------------------------------------------------ *
 * Test-local arithmetic. Shares no code with the lab.
 * ------------------------------------------------------------------ */

function dotProduct(x: readonly bigint[], y: readonly bigint[]): bigint {
  let acc = 0n;
  for (let i = 0; i < x.length; i++) acc += x[i] * y[i];
  return acc;
}

/** Read a vector straight out of the page's number inputs. */
async function readVector(page: Page, which: 'x' | 'y'): Promise<bigint[]> {
  const values = await page
    .locator(`input[data-vec="${which}"]`)
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(values.length, `expected some ${which} inputs on the page`).toBeGreaterThan(0);
  return values.map((v) => BigInt(v));
}

async function verdictText(page: Page, id: string): Promise<string> {
  return (await page.locator(`[data-verdict="${id}"]`).innerText()).trim();
}

/** A verdict's tone, which is what carries pass/fail independently of wording. */
async function verdictTone(page: Page, id: string): Promise<string | null> {
  return page.locator(`[data-verdict="${id}"]`).getAttribute('data-tone');
}

async function fieldText(page: Page, scope: string, field: string): Promise<string> {
  return (await page.locator(`${scope} [data-field="${field}"]`).first().innerText()).trim();
}

async function setVec(page: Page, which: 'x' | 'y', index: number, value: string): Promise<void> {
  await page.locator(`input[data-vec="${which}"][data-index="${index}"]`).fill(value);
}

async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('.');
  await expect(page.locator('h1')).toHaveText('Function Key');
  // A renderer that threw would leave an empty panel, and an empty panel
  // satisfies almost any assertion about what is NOT on it.
  await expect(page.locator('#panel-keys')).not.toBeEmpty();
  expect(errors, errors.join('\n')).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * Invariant 1 — correctness, by independent re-derivation
 * ------------------------------------------------------------------ */

test('Invariant 1: the answer on screen is the integer dot product of the vectors on screen', async ({
  page,
}) => {
  const cases: [string, string[], string[]][] = [
    ['default', ['3', '1', '4', '1'], ['2', '0', '1', '5']],
    ['signed', ['-3', '5', '-1', '2'], ['4', '-2', '6', '1']],
    ['orthogonal', ['2', '3', '-1', '4'], ['3', '-2', '0', '0']],
    ['zero y', ['7', '-2', '3', '9'], ['0', '0', '0', '0']],
    ['both negative', ['-9', '-9', '-4', '-1'], ['-2', '-3', '-1', '-5']],
  ];

  for (const [label, xs, ys] of cases) {
    for (const [i, v] of xs.entries()) await setVec(page, 'x', i, v);
    for (const [i, v] of ys.entries()) await setVec(page, 'y', i, v);

    // Read the vectors back OUT of the page, so the test computes over what the
    // page actually holds rather than over what it tried to type.
    const x = await readVector(page, 'x');
    const y = await readVector(page, 'y');
    const expected = dotProduct(x, y);

    // The page's own two printed numbers must agree with each other...
    const computed = await fieldText(page, '#panel-keys', 'computed');
    const claimed = await fieldText(page, '#panel-keys', 'expected');
    expect(computed, `${label}: the page's two printed values must agree`).toBe(claimed);

    // ...and with the test's independent arithmetic.
    expect(BigInt(computed), `${label}: page answer vs test dot product`).toBe(expected);

    // And the verdict must be reporting that, not asserting it.
    expect(await verdictTone(page, 'correctness'), `${label}: verdict tone`).toBe('ok');
    expect(await verdictText(page, 'correctness')).toContain('MATCHES THE DOT PRODUCT');
  }
});

test('Invariant 1: the recovered integer is what the big display shows, not a different number', async ({
  page,
}) => {
  // Two surfaces that must agree: the headline `.recovered-int` and the
  // `data-field="computed"` footnote are rendered from the same search result
  // but written separately, so a divergence is a real reporting bug.
  const shown = (await page.locator('#panel-keys .recovered-int').innerText()).trim();
  const computed = await fieldText(page, '#panel-keys', 'computed');
  expect(shown).toBe(computed);
  expect(BigInt(shown)).toBe(
    dotProduct(await readVector(page, 'x'), await readVector(page, 'y')),
  );
});

test('edge case 5: the functional key is a canonical scalar mod l, never a raw integer', async ({
  page,
}) => {
  // Entries of x and y are signed integers; sk_y is a scalar mod l. The page
  // asserts the reduction rather than assuming it, and the test re-checks the
  // range here from the printed value.
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;

  for (const [i, v] of ['-9', '-9', '-9', '-9'].entries()) {
    await setVec(page, 'y', i, v);
  }
  // A y that is all negative makes the raw <s, y> negative before reduction,
  // which is exactly the case a truncating mod would get wrong.
  const sk = BigInt(await fieldText(page, '#panel-keys', 'sk'));
  expect(sk, 'sk_y must not be negative').toBeGreaterThanOrEqual(0n);
  expect(sk, 'sk_y must be below the group order').toBeLessThan(L);
  expect(await verdictTone(page, 'scalar-canonical')).toBe('ok');
  expect(await verdictText(page, 'scalar-canonical')).toContain('CANONICAL SCALAR');

  // And the answer is still right, so the reduction did not cost correctness.
  expect(BigInt(await fieldText(page, '#panel-keys', 'computed'))).toBe(
    dotProduct(await readVector(page, 'x'), await readVector(page, 'y')),
  );
});

/* ------------------------------------------------------------------ *
 * Invariant 2 — randomized encryption
 * ------------------------------------------------------------------ */

test('Invariant 2: a fresh encryption changes EVERY ciphertext component', async ({ page }) => {
  await openTab(page, /Decrypt/, '#panel-decrypt');

  // On arrival there is nothing to compare against, and the page says so
  // rather than claiming a pass it has not earned.
  expect(await verdictTone(page, 'randomized')).toBe('info');
  expect(await verdictText(page, 'randomized')).toContain('NO PREVIOUS CIPHERTEXT');

  const before = await page
    .locator('#panel-decrypt .group-el')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));

  await openTab(page, /Two kinds/, '#panel-keys');
  await page.getByRole('button', { name: 'Encrypt again' }).click();
  await openTab(page, /Decrypt/, '#panel-decrypt');

  // Now the page reports the comparison, per component.
  expect(await verdictTone(page, 'randomized')).toBe('ok');
  expect(await verdictText(page, 'randomized')).toContain('EVERY COMPONENT CHANGED');

  // ct_0 and all four ct_i each reported as CHANGED, independently.
  expect(await verdictTone(page, 'component-ct0')).toBe('ok');
  for (let i = 0; i < 4; i++) {
    expect(await verdictTone(page, `component-${i}`), `ct_${i + 1} must have changed`).toBe('ok');
  }

  // Checked again by the test, against the actual rendered encodings: no value
  // from the previous ciphertext may reappear anywhere in the new one.
  const ct0 = await fieldText(page, '#panel-decrypt', 'ct0-now');
  const now = [ct0];
  for (let i = 0; i < 4; i++) now.push(await fieldText(page, '#panel-decrypt', `ct-now-${i}`));
  expect(new Set(now).size, 'the five components must be distinct from each other').toBe(5);
  for (const v of now) {
    expect(before, `component ${v} repeated from the previous ciphertext`).not.toContain(v);
  }
});

test('Invariant 2: the decrypted element is UNCHANGED by re-encryption — the r cancels', async ({
  page,
}) => {
  // The other half of the same fact, and the one a test is most likely to get
  // backwards: g^<x,y> is deterministic. The ciphertext is randomized; the
  // answer it decrypts to is not, because the r terms cancel. A test asserting
  // the element changes would be asserting the scheme is broken.
  // Read the vectors first: the x and y inputs live in exhibit 1, and a
  // non-active panel is emptied, so they are not in the DOM from elsewhere.
  const x = await readVector(page, 'x');
  const y = await readVector(page, 'y');

  await openTab(page, /Decrypt/, '#panel-decrypt');
  const element = await fieldText(page, '#panel-decrypt', 'element');
  const answer = await fieldText(page, '#panel-decrypt', 'computed');

  await openTab(page, /Two kinds/, '#panel-keys');
  await page.getByRole('button', { name: 'Encrypt again' }).click();
  await openTab(page, /Decrypt/, '#panel-decrypt');

  expect(await fieldText(page, '#panel-decrypt', 'element')).toBe(element);
  expect(await fieldText(page, '#panel-decrypt', 'computed')).toBe(answer);
  expect(BigInt(answer)).toBe(dotProduct(x, y));
});

test('Invariant 2: a new master key changes the ciphertext, and still the same answer', async ({
  page,
}) => {
  await openTab(page, /Decrypt/, '#panel-decrypt');
  const ct0 = await fieldText(page, '#panel-decrypt', 'ct0-now');
  const answer = await fieldText(page, '#panel-decrypt', 'computed');

  await openTab(page, /Two kinds/, '#panel-keys');
  await page.getByRole('button', { name: 'New master key' }).click();
  await openTab(page, /Decrypt/, '#panel-decrypt');

  // A different s means different h_i, so a different ciphertext...
  expect(await fieldText(page, '#panel-decrypt', 'ct0-now')).not.toBe(ct0);
  expect(await verdictTone(page, 'randomized')).toBe('ok');
  // ...and the same inner product, because the answer is a property of x and y.
  expect(await fieldText(page, '#panel-decrypt', 'computed')).toBe(answer);
  expect(await verdictTone(page, 'decrypt-exact')).toBe('ok');
});

/* ------------------------------------------------------------------ *
 * Invariant 3 — out of range is a failure, never a wrapped value
 * ------------------------------------------------------------------ */

test('Invariant 3: below the answer, the search reports no value and prints no integer', async ({
  page,
}) => {
  const x = await readVector(page, 'x');
  const y = await readVector(page, 'y');
  const answer = dotProduct(x, y);
  expect(answer).toBe(15n); // the shipped default, restated so a change is loud

  // Lower B under the answer. This is the only honest route to the refusal:
  // with n <= 8 and entries in [-9, 9] the largest reachable product is 648,
  // which is inside the default bound of 1024, so no input can go out of range
  // at the default.
  await openTab(page, /bottleneck/, '#panel-bottleneck');
  await page.locator('#bound-slider').fill('3');
  await expect(page.locator('#bound-readout')).toContainText('B = 8;');

  await openTab(page, /Decrypt/, '#panel-decrypt');
  expect(await verdictText(page, 'range-search')).toContain('SEARCH EXHAUSTED');

  // THE POINT: no integer is rendered at all. Not a wrong one, not a wrapped
  // one, not a zero. The element is present (decryption succeeded) and the
  // answer is absent.
  await expect(page.locator('#panel-decrypt .recovered-int')).toHaveCount(0);
  await expect(page.locator('#panel-decrypt .pending-int')).toHaveCount(1);
  // Scoped to the combined element specifically: the panel also renders the
  // five ciphertext components as `.group-el`, and the claim here is about the
  // decrypted element still being present while the integer is absent.
  await expect(page.locator('#panel-decrypt [data-field="element"]')).toHaveCount(1);

  // No integer is offered AS THE ANSWER. The page does still print the true
  // inner product in its explanatory footnote — that is honest disclosure of
  // what was out of range, not a returned value — so the claim has to be about
  // the answer slots specifically rather than about the panel's prose.
  const pending = (await page.locator('#panel-decrypt .pending-int').innerText()).trim();
  expect(pending).toMatch(/no value/i);
  expect(pending, 'the answer slot must not contain a number').not.toMatch(/\d/);
  // And the footnote names the out-of-range value as the EXPECTED one, which is
  // the only place it may appear.
  expect(BigInt(await fieldText(page, '#panel-decrypt', 'expected'))).toBe(answer);

  // Widen it again and the same product comes back, unchanged.
  await openTab(page, /bottleneck/, '#panel-bottleneck');
  await page.locator('#bound-slider').fill('11');
  await openTab(page, /Decrypt/, '#panel-decrypt');
  expect(BigInt(await fieldText(page, '#panel-decrypt', 'computed'))).toBe(answer);
});

test('Invariant 3: the boundary table is right at +/-B and +/-(B+1), in both directions', async ({
  page,
}) => {
  await openTab(page, /bottleneck/, '#panel-bottleneck');

  // Four rows: +25 inside, +25 outside, -25 inside, -25 outside. Every row
  // prints both the returned and the expected value, and all four must pass —
  // the two "outside" rows pass by correctly returning nothing.
  const rows = page
    .locator('[aria-label="Boundary behaviour of the bounded search"] table')
    .locator('tbody tr');
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const cells = rows.nth(i).locator('td');
    const returned = (await cells.nth(1).innerText()).trim();
    const expected = (await cells.nth(2).innerText()).trim();
    expect(returned, `boundary row ${i}: returned vs expected`).toBe(expected);
    expect(await verdictTone(page, `edge-${i}`)).toBe('ok');
  }

  // The negative half is specifically asserted, because an asymmetric range
  // passes every positive case while silently losing every negative one.
  const negInside = (await rows.nth(2).locator('td').nth(1).innerText()).trim();
  expect(negInside).toBe('-25');

  expect(await verdictText(page, 'range-edge')).toContain('SYMMETRIC RANGE');
  expect(await verdictTone(page, 'range-edge')).toBe('ok');
});

/* ------------------------------------------------------------------ *
 * Invariant 4 — the cost law
 * ------------------------------------------------------------------ */

test('Invariant 4: sqrt scaling, recomputed from the table the page printed', async ({ page }) => {
  await openTab(page, /bottleneck/, '#panel-bottleneck');

  // Parse the cost table's own numbers and redo its arithmetic here.
  const rows = await page
    .locator('[aria-label="BSGS cost by search width, as a table"] table')
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()),
      ),
    );
  expect(rows.length, 'the cost law needs at least three widths').toBeGreaterThanOrEqual(3);

  const ratios: number[] = [];
  for (const [widthS, opsS, refS, ratioS] of rows) {
    const width = Number(widthS);
    const ops = Number(opsS);

    // The page's own fourth column must be ops / sqrt(W). Recomputed here.
    const ratio = ops / Math.sqrt(width);
    expect(Number(ratioS), `ops/sqrt(W) for W=${width}`).toBeCloseTo(ratio, 3);

    // And its third column must be 2*sqrt(W).
    expect(Number(refS), `2*sqrt(W) for W=${width}`).toBeCloseTo(2 * Math.sqrt(width), 1);

    ratios.push(ratio);
  }

  // The law itself, judged on the page's numbers: the ratio stays flat. A cost
  // linear in W would make this spread explode.
  const spread = Math.max(...ratios) / Math.min(...ratios);
  expect(spread, 'ops/sqrt(W) must stay flat across the sweep').toBeLessThan(1.2);
  for (const r of ratios) {
    expect(r).toBeGreaterThan(1.5);
    expect(r).toBeLessThan(2.5);
  }

  // Quadrupling the width must roughly double the cost, never quadruple it.
  for (let i = 1; i < rows.length; i++) {
    const growth = Number(rows[i][1]) / Number(rows[i - 1][1]);
    expect(growth, `growth from row ${i - 1} to ${i}`).toBeGreaterThan(1.7);
    expect(growth).toBeLessThan(2.3);
  }

  // The verdict must agree, and the spread it cites must be the one just computed.
  expect(await verdictTone(page, 'cost-law')).toBe('ok');
  const citedSpread = Number(await fieldText(page, '#panel-bottleneck', 'ratio-spread'));
  expect(citedSpread).toBeCloseTo(spread, 2);
  const citedMin = Number(await fieldText(page, '#panel-bottleneck', 'ratio-min'));
  const citedMax = Number(await fieldText(page, '#panel-bottleneck', 'ratio-max'));
  expect(citedMin).toBeCloseTo(Math.min(...ratios), 3);
  expect(citedMax).toBeCloseTo(Math.max(...ratios), 3);
});

test('Invariant 4: the live readout agrees with the slider, and the table is the chart', async ({
  page,
}) => {
  await openTab(page, /bottleneck/, '#panel-bottleneck');
  for (const [exp, bound] of [
    ['3', 8n],
    ['10', 1024n],
    ['16', 65536n],
    ['21', 2097152n],
  ] as const) {
    await page.locator('#bound-slider').fill(exp);
    const readout = await page.locator('#bound-readout').innerText();
    // B, and the width W = 2B+1, must both be what the exponent implies.
    expect(readout).toContain(`B = ${bound};`);
    expect(readout).toContain(`width W = ${2n * bound + 1n};`);
  }
});

/* ------------------------------------------------------------------ *
 * Invariant 5 — k < n keys do not determine x  (and section 4.1d shape)
 * ------------------------------------------------------------------ */

test('Invariant 5: with k < n keys the page shows a family and NEVER a single x', async ({
  page,
}) => {
  await openTab(page, /Collect keys/, '#panel-collect');

  // Rank 0: nothing known.
  expect(await verdictText(page, 'partial')).toContain('4 FREE DIMENSIONS REMAIN');

  const request = async () =>
    page.locator('#panel-collect button[data-request-key]').first().click();

  for (const [n, freeDims] of [
    [1, 3],
    [2, 2],
    [3, 1],
  ] as const) {
    await request();
    await expect(page.locator('#panel-collect [data-verdict^="offer-"]')).toHaveCount(n);

    // The dimension the page states must be n - rank, checked against the
    // number of keys actually issued rather than against itself.
    expect(await verdictText(page, 'partial')).toContain(`${freeDims} FREE DIMENSIONS REMAIN`);

    // The rule from the brief's visual semantics: no single x is drawn.
    const family = await fieldText(page, '#panel-collect', 'family');
    expect(family, 'an unpinned state must show a parameterised family').toMatch(/t1\(/);
    expect(await verdictTone(page, 'partial')).toBe('ok');
  }
});

test('Invariant 5 evidence fixture: two DIFFERENT x stay consistent with every answer', async ({
  page,
}) => {
  await openTab(page, /Collect keys/, '#panel-collect');
  await page.locator('#panel-collect button[data-request-key]').first().click();
  await page.locator('#panel-collect button[data-request-key]').first().click();
  await expect(page.locator('#panel-collect [data-verdict^="offer-"]')).toHaveCount(2);

  // The page prints both candidates and the answers received. Recompute each
  // candidate's dot product HERE and check the page's consistency verdicts.
  const table = page.locator('#panel-collect table').first();
  const grid = await table.locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim())),
  );
  expect(grid.length).toBe(3); // xA, xB, answers

  const parseVec = (s: string): bigint[] =>
    (s.match(/-?\d+/g) ?? []).map(BigInt).slice(-4);

  const xA = parseVec(grid[0][0]);
  const xB = parseVec(grid[1][0]);
  expect(xA.length).toBe(4);
  expect(xB.length).toBe(4);
  expect(xA, 'the two candidates must actually differ').not.toEqual(xB);

  // The y vectors come from the table header.
  const heads = await table
    .locator('thead th')
    .evaluateAll((ths) => ths.map((th) => (th.textContent ?? '').trim()));
  const ys = heads.slice(1, -1).map((h) => (h.match(/-?\d+/g) ?? []).map(BigInt));
  expect(ys.length).toBe(2);

  for (let k = 0; k < ys.length; k++) {
    const answer = BigInt(grid[2][k + 1]);
    // Both candidates produce the answer the page received. Computed here.
    expect(dotProduct(xA, ys[k]), `xA on key ${k}`).toBe(answer);
    expect(dotProduct(xB, ys[k]), `xB on key ${k}`).toBe(answer);
    // And the page agrees with the numbers in its own cells.
    expect(BigInt(grid[0][k + 1])).toBe(answer);
    expect(BigInt(grid[1][k + 1])).toBe(answer);
  }

  expect(await verdictTone(page, 'xa-consistent')).toBe('ok');
  expect(await verdictTone(page, 'xb-consistent')).toBe('ok');
  expect(await verdictText(page, 'two-candidates')).toContain('BOTH REMAIN CONSISTENT');
});

/* ------------------------------------------------------------------ *
 * Invariant 6 — full reconstruction
 * ------------------------------------------------------------------ */

test('Invariant 6: at full rank x is recovered exactly, and it is the encrypted vector', async ({
  page,
}) => {
  await openTab(page, /Collect keys/, '#panel-collect');
  for (let i = 0; i < 4; i++) {
    await page.locator('#panel-collect button[data-request-key]').first().click();
    await expect(page.locator('#panel-collect [data-verdict^="offer-"]')).toHaveCount(i + 1);
  }

  expect(await verdictText(page, 'partial')).toContain('x IS NOW DETERMINED');
  expect(await verdictTone(page, 'reconstruct')).toBe('ok');

  // The page prints the recovered vector and the encrypted one separately.
  const recovered = (await fieldText(page, '#panel-collect', 'computed'))
    .split(',')
    .map((s) => s.trim());
  const encrypted = (await fieldText(page, '#panel-collect', 'expected'))
    .split(',')
    .map((s) => s.trim());
  expect(recovered).toEqual(encrypted);

  // Exactness: every coordinate is an integer, with no fraction slash anywhere.
  for (const c of recovered) expect(c, `coordinate ${c} must be an exact integer`).toMatch(/^-?\d+$/);

  // Independent re-derivation: the recovered x must reproduce every answer the
  // page received, recomputed here by plain multiplication.
  const table = page.locator('#panel-collect table').first();
  const heads = await table
    .locator('thead th')
    .evaluateAll((ths) => ths.map((th) => (th.textContent ?? '').trim()));
  const ys = heads.slice(1, -1).map((h) => (h.match(/-?\d+/g) ?? []).map(BigInt));
  const grid = await table.locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim())),
  );
  const answers = grid[2].slice(1, 1 + ys.length).map(BigInt);
  const rec = recovered.map(BigInt);
  for (let k = 0; k < ys.length; k++) {
    expect(dotProduct(rec, ys[k]), `recovered x must reproduce answer ${k}`).toBe(answers[k]);
  }

  // And the family notation is gone: a pinned state must not still advertise
  // free parameters.
  await expect(page.locator('#panel-collect [data-field="family"]')).toHaveCount(0);
});

test('Invariant 6 retirement and no-op guard: returning the keys retires the reconstruction', async ({
  page,
}) => {
  await openTab(page, /Collect keys/, '#panel-collect');
  for (let i = 0; i < 4; i++) {
    await page.locator('#panel-collect button[data-request-key]').first().click();
  }
  expect(await verdictText(page, 'partial')).toContain('x IS NOW DETERMINED');

  // RETIREMENT: hand the keys back. The recovered x must be gone, not stale,
  // and the page must say what it now knows instead.
  await page.getByRole('button', { name: 'Return all keys' }).click();
  await expect(page.locator('#panel-collect [data-verdict="reconstruct"]')).toHaveCount(0);
  expect(await verdictText(page, 'partial')).toContain('4 FREE DIMENSIONS REMAIN');
  await expect(page.locator('#panel-collect table')).toHaveCount(0);

  // NO-OP GUARD: returning them again changes nothing and must not fabricate a
  // fresh verdict.
  await page.getByRole('button', { name: 'Return all keys' }).click();
  expect(await verdictText(page, 'partial')).toContain('4 FREE DIMENSIONS REMAIN');
  await expect(page.locator('#panel-collect [data-verdict="reconstruct"]')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * Invariants 7 and 8 — master secret, and refusal
 * ------------------------------------------------------------------ */

test('Invariant 8: four dependent keys are refused, with the rank shown and no s printed', async ({
  page,
}) => {
  await openTab(page, /Keys alone/, '#panel-alone');
  expect(await verdictText(page, 'rank-refusal')).toContain('RANK 0 OF 4');

  for (let i = 0; i < 4; i++) {
    await page.locator('#panel-alone button[data-request-alone]').first().click();
    await expect(page.locator('#panel-alone [data-verdict^="alone-offer-"]')).toHaveCount(i + 1);
  }

  // Four keys held, rank still 2 — a scalar multiple and an exact duplicate
  // each add an equation that was already implied.
  const text = await verdictText(page, 'rank-refusal');
  expect(text).toContain('RANK 2 OF 4');
  expect(text).toContain('RECOVERY REFUSED');

  // The refusal is the claim: no master secret and no forged key anywhere.
  await expect(page.locator('#panel-alone [data-verdict="master"]')).toHaveCount(0);
  await expect(page.locator('#panel-alone .alarm-box')).toHaveCount(0);
  const panel = await page.locator('#panel-alone').innerText();
  expect(panel, 'a refused recovery must not print a candidate s').not.toMatch(/s recovered/i);
});

test('Invariant 7: n independent keys recover s, and the forged key decrypts a fresh ciphertext', async ({
  page,
}) => {
  await openTab(page, /Keys alone/, '#panel-alone');
  for (let i = 0; i < 6; i++) {
    await page.locator('#panel-alone button[data-request-alone]').first().click();
    await expect(page.locator('#panel-alone [data-verdict^="alone-offer-"]')).toHaveCount(i + 1);
  }

  expect(await verdictText(page, 'rank-refusal')).toContain('s RECOVERED');
  expect(await verdictTone(page, 'master')).toBe('ok');
  expect(await verdictText(page, 'master')).toContain(
    'FORGED KEY DECRYPTS A FRESH CIPHERTEXT CORRECTLY',
  );

  // The proof the page offers: a key for a y it never issued. Assert that the
  // y really was never issued, from the page's own issued list.
  expect(await verdictTone(page, 'never-issued')).toBe('ok');

  // Two surfaces that must agree: the forged scalar and the authority's own
  // scalar for the same y. If those two ever differ, the forgery failed.
  const scalars = await page
    .locator('#panel-alone .alarm-box .group-el')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  expect(scalars.length).toBeGreaterThanOrEqual(2);
  expect(scalars[0], 'forged sk_y must equal the authority\'s sk_y').toBe(scalars[1]);

  // And the decrypted answer matches the expected one, both printed by the page.
  const computed = await fieldText(page, '#panel-alone', 'computed');
  const expected = await fieldText(page, '#panel-alone', 'expected');
  expect(computed).toBe(expected);
  expect(BigInt(computed)).not.toBeNaN;

  // The scoping sentence must be present — this is the claim most at risk of
  // quietly widening into "IPFE is broken".
  const notClaimed = await fieldText(page, '#panel-alone', 'not-claimed');
  expect(notClaimed).toContain('adaptively secure');
  expect(notClaimed.toLowerCase()).toContain('collusion is harmless');
  const why = await fieldText(page, '#panel-alone', 'why-permitted');
  expect(why).toMatch(/only constrains keys/i);
});

/* ------------------------------------------------------------------ *
 * The fixtures table, including the row that is wrong on purpose
 * ------------------------------------------------------------------ */

test('the fixtures table prints both values on EVERY row and reports the wrong one failing', async ({
  page,
}) => {
  await openTab(page, /Fixtures/, '#panel-fixtures');

  const rows = await page.locator('#panel-fixtures tbody tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      fixture: tr.getAttribute('data-fixture'),
      state: tr.getAttribute('data-row-state'),
      cells: Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()),
    })),
  );
  expect(rows.length).toBe(7);

  let failing = 0;
  for (const r of rows) {
    const [, , xs, ys, computed, claimed] = r.cells;
    const x = (xs.match(/-?\d+/g) ?? []).map(BigInt);
    const y = (ys.match(/-?\d+/g) ?? []).map(BigInt);

    // BOTH values present on every row, always — not only when they differ.
    expect(computed, `${r.fixture}: computed must be printed`).not.toBe('');
    expect(claimed, `${r.fixture}: claimed must be printed`).not.toBe('');

    // The COMPUTED value is the scheme's, and it must equal the test's own dot
    // product for that row's vectors regardless of what the row claims.
    expect(BigInt(computed), `${r.fixture}: scheme vs test dot product`).toBe(dotProduct(x, y));

    const agrees = computed === claimed;
    expect(r.state, `${r.fixture}: row state must track the comparison`).toBe(
      agrees ? 'pass' : 'fail',
    );
    expect(await verdictTone(page, `fixture-${r.fixture}`)).toBe(agrees ? 'ok' : 'fail');
    if (!agrees) failing++;
  }

  // EXACTLY ONE row disagrees, and it is the one that is wrong on purpose.
  // A table seen only agreeing proves nothing, so this is the assertion that
  // makes every other row's PASS mean something.
  expect(failing, 'exactly one fixture must be reported as disagreeing').toBe(1);
  const wrong = rows.find((r) => r.state === 'fail');
  expect(wrong?.fixture).toBe('wrong-on-purpose');
  expect(wrong?.cells[4]).toBe('15'); // what the scheme computes
  expect(wrong?.cells[5]).toBe('16'); // what the row claims
  expect(await verdictText(page, 'wrong-fixture-detected')).toContain('REPORTED AS DISAGREEING');
});

/* ------------------------------------------------------------------ *
 * Section 4.1d — the negative claim, with its three required assertions
 * ------------------------------------------------------------------ */

test('4.1d negative claim: every check is green AND the property is violated anyway', async ({
  page,
}) => {
  // 1. REACH THE FIXTURE, through the UI.
  await openTab(page, /Honesty/, '#panel-honesty');

  // 2. EVERYTHING IS GREEN — asserted against the RENDERED verdicts, not a
  //    flag the test sets. If any of these failed, the fixture would be
  //    demonstrating the mechanism working rather than its limit.
  for (const id of ['maul-decrypts', 'maul-correct', 'maul-undetected']) {
    expect(await verdictTone(page, id), `${id} must report success`).toBe('ok');
  }

  // The mauled ciphertext decrypted, and it decrypted CORRECTLY — to the sum.
  // Parts-sum-to-whole, recomputed here from the page's own three numbers:
  // the original answer, the mauled answer, and the expected sum.
  const table = page.locator('#panel-honesty table');
  const cells = await table.locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim())),
  );
  const original = BigInt(cells[0][1]);
  const mauled = BigInt(cells[1][1]);
  const expectedSum = BigInt(cells[2][1]);
  expect(mauled, 'the mauled ciphertext must decrypt to the expected sum').toBe(expectedSum);
  // And the sum is genuinely a DIFFERENT plaintext's answer.
  expect(mauled, 'the answer must have moved, or nothing was demonstrated').not.toBe(original);

  // 3. THE LIMITATION IS ON SCREEN IN THAT STATE — visible, not in the README
  //    and not behind a disclosure.
  const claim = await fieldText(page, '#panel-honesty', 'negative-claim');
  expect(claim).toContain('additively malleable');
  expect(claim).toMatch(/no integrity/i);
  expect(claim).toMatch(/decryption cannot tell/i);
  await expect(page.locator('#panel-honesty [data-field="negative-claim"]')).toBeVisible();

  // The verdict that reads as success and failure at once.
  expect(await verdictText(page, 'negative-claim-verdict')).toContain('DECRYPTED — AND MODIFIED');

  // The absence of a failure code is the exhibit, so the page must say that
  // rather than invent one.
  const panel = await page.locator('#panel-honesty').innerText();
  expect(panel).toMatch(/absence of a failure code is the exhibit/i);
});

test('4.1d: the honesty panel scopes what is NOT built, and names the selective/adaptive gap', async ({
  page,
}) => {
  await openTab(page, /Honesty/, '#panel-honesty');
  const panel = await page.locator('#panel-honesty').innerText();

  // Selective vs adaptive: the single most likely thing to be overstated.
  expect(panel).toMatch(/selective/i);
  expect(panel).toMatch(/ALS16/);
  // The Paillier attribution, which is the narrower and correct claim.
  expect(panel).toMatch(/Paillier/);
  expect(panel).toMatch(/not production/i);
});

/* ------------------------------------------------------------------ *
 * The [hidden] probe from section 4.1
 * ------------------------------------------------------------------ */

test('[hidden] means hidden: no class rule outranks the UA rule on a tabpanel', async ({
  page,
}) => {
  // The trap: a class rule setting `display` outranks the UA `[hidden]` rule,
  // so an element paints while the code believes it is hidden. Measured here
  // rather than reasoned about.
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('[hidden]').forEach((el) => {
      const e = el as HTMLElement;
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (cs.display !== 'none' || r.width > 0 || r.height > 0) {
        out.push(`${e.id || e.tagName}: display=${cs.display} ${r.width}x${r.height}`);
      }
    });
    return out;
  });
  expect(bad, `elements carrying [hidden] but still painting: ${bad.join('; ')}`).toEqual([]);

  // And the inactive panels really are hidden AND empty on arrival, so a scan
  // cannot pass by finding nothing.
  for (const id of ['decrypt', 'bottleneck', 'collect', 'alone', 'fixtures', 'compare', 'honesty']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).toBeEmpty();
  }
});

/* ------------------------------------------------------------------ *
 * Cross-checks between surfaces that must agree
 * ------------------------------------------------------------------ */

test('cross-check: the rank meter, the stated rank, and the keys actually issued agree', async ({
  page,
}) => {
  await openTab(page, /Collect keys/, '#panel-collect');

  for (let issued = 1; issued <= 4; issued++) {
    await page.locator('#panel-collect button[data-request-key]').first().click();
    await expect(page.locator('#panel-collect [data-verdict^="offer-"]')).toHaveCount(issued);

    const dl = await page.locator('#panel-collect dl.kv').first().innerText();
    // "keys held" must equal the number of ISSUED badges on the page.
    expect(dl).toMatch(new RegExp(`keys held\\s*\\n?\\s*${issued}`));

    // The filled cells in the dimension meter must equal the stated rank.
    const filled = await page
      .locator('#panel-collect .dim-cell[data-filled="yes"]')
      .count();
    const rankMatch = dl.match(/rank of the y vectors\s*\n?\s*(\d+) of (\d+)/);
    expect(rankMatch, 'the panel must state a rank').not.toBeNull();
    expect(filled, 'meter cells must equal the stated rank').toBe(Number(rankMatch?.[1]));

    // Every offer in this list is independent, so rank must equal keys issued.
    expect(Number(rankMatch?.[1])).toBe(issued);
  }
});

test('cross-check: the dimension select changes the number of inputs it advertises', async ({
  page,
}) => {
  for (const n of ['1', '4', '8']) {
    await page.locator('#n-select').selectOption(n);
    await expect(page.locator('input[data-vec="x"]')).toHaveCount(Number(n));
    await expect(page.locator('input[data-vec="y"]')).toHaveCount(Number(n));
    // And the answer still checks out at that dimension.
    const x = await readVector(page, 'x');
    const y = await readVector(page, 'y');
    expect(BigInt(await fieldText(page, '#panel-keys', 'computed'))).toBe(dotProduct(x, y));
  }
});

test('cross-check: the honesty panel states the same n and B the controls are set to', async ({
  page,
}) => {
  await page.locator('#n-select').selectOption('6');
  await openTab(page, /bottleneck/, '#panel-bottleneck');
  await page.locator('#bound-slider').fill('16');
  await openTab(page, /Honesty/, '#panel-honesty');
  const panel = await page.locator('#panel-honesty').innerText();
  // Hand-authored prose vs the live state.
  expect(panel).toContain('n = 6');
  expect(panel).toContain('B = 65536');
});

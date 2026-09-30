/**
 * THE CLAIMS SUITE — does the page tell the truth?
 *
 * The rule that makes these tests worth anything: compare two values the page
 * itself printed, or recompute the claim from the page's raw inputs BY A
 * DIFFERENT ROUTE than the source takes. A test that re-derives the same
 * expression the source uses will happily agree with a bug in it.
 *
 * The workhorse is `dotProduct` below — a plain integer loop over the x and y
 * values read out of the page's own fields. The page reaches its answer the
 * long way round: exponentiate into ristretto255, combine the ciphertext,
 * divide out ct_0, then search for the exponent in a worker. The test
 * multiplies and adds. Independent routes to the same number.
 *
 * Nothing here imports from `src/`.
 */

import { expect, test, type Page } from '@playwright/test';

/* ------------------------------------------------------------------ *
 * Test-local arithmetic and helpers
 * ------------------------------------------------------------------ */

function dotProduct(x: readonly bigint[], y: readonly bigint[]): bigint {
  let acc = 0n;
  for (let i = 0; i < x.length; i++) acc += x[i] * y[i];
  return acc;
}

async function readVector(page: Page, which: 'x' | 'y'): Promise<bigint[]> {
  const values = await page
    .locator(`input[data-vec="${which}"]`)
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(values.length, `expected some ${which} inputs on the page`).toBeGreaterThan(0);
  return values.map((v) => BigInt(v));
}

const verdictText = async (page: Page, id: string): Promise<string> =>
  (await page.locator(`[data-verdict="${id}"]`).innerText()).trim();

const verdictTone = async (page: Page, id: string): Promise<string | null> =>
  page.locator(`[data-verdict="${id}"]`).getAttribute('data-tone');

const fieldText = async (page: Page, scope: string, field: string): Promise<string> =>
  (await page.locator(`${scope} [data-field="${field}"]`).first().innerText()).trim();

const setVec = (page: Page, which: 'x' | 'y', i: number, v: string): Promise<void> =>
  page.locator(`input[data-vec="${which}"][data-index="${i}"]`).fill(v);

async function openStage(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/** Drive the staged decrypt all the way through and wait for a real result. */
async function runStagedDecrypt(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Apply functional key' }).click();
  await expect(page.locator('#panel-decode [data-field="element"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Recover the integer' }).click();
  await expect(
    page.locator(
      '#panel-decode [data-verdict="decrypt-exact"], #panel-decode [data-verdict="range-search"]',
    ),
  ).toHaveCount(1);
}

/** Open every disclosure in a panel the way a reader does. */
async function openDisclosures(page: Page, panelId: string): Promise<void> {
  for (;;) {
    const s = page.locator(`${panelId} details.disclose:not([open]) > summary`).first();
    if ((await s.count()) === 0) break;
    await s.click();
  }
}

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('.');
  await expect(page.locator('h1')).toHaveText('Function Key');
  await expect(page.locator('#panel-ask')).not.toBeEmpty();
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

    const expected = dotProduct(await readVector(page, 'x'), await readVector(page, 'y'));

    // Three surfaces must agree: the scenario bar's expected value, the
    // analyst's recovered value, and the test's own arithmetic.
    expect(
      BigInt(await fieldText(page, '#scenario-host', 'scenario-expected')),
      `${label}: scenario bar`,
    ).toBe(expected);
    expect(BigInt(await fieldText(page, '#panel-ask', 'computed')), `${label}: scheme`).toBe(
      expected,
    );
    expect(await verdictTone(page, 'correctness'), `${label}: verdict tone`).toBe('ok');
  }
});

/**
 * STAGE 1'S AUTHORITY COLUMN IS EXECUTED, NOT ECHOED.
 *
 * This is the test for a real honesty defect: that column used to render
 * `state.x` — the value the reader typed — under the label "x recovered",
 * while the panel claimed the ciphertext had been "opened two ways". It is now
 * n real basis-key decryptions.
 */
test('the authority column comes from decryptions, not from the input field', async ({ page }) => {
  await setVec(page, 'x', 0, '-7');
  await setVec(page, 'x', 1, '6');
  const x = await readVector(page, 'x');

  expect(await fieldText(page, '#panel-ask', 'authority-vector')).toBe(`(${x.join(', ')})`);
  expect(await verdictTone(page, 'authority-recovery')).toBe('ok');

  // The mechanism claim: each coordinate is <x, e_i>, an ordinary functional
  // key answer. Recomputed here for every basis vector.
  for (let i = 0; i < x.length; i++) {
    const e = x.map((_, j) => (j === i ? 1n : 0n));
    expect(dotProduct(x, e), `coordinate ${i} must equal <x, e_${i + 1}>`).toBe(x[i]);
  }

  // A re-encryption does not change it: it is a property of the plaintext,
  // reached through whatever ciphertext currently exists.
  await page.getByRole('button', { name: 'Encrypt again' }).click();
  expect(await fieldText(page, '#panel-ask', 'authority-vector')).toBe(`(${x.join(', ')})`);
  expect(await verdictTone(page, 'authority-recovery')).toBe('ok');
});

/* ------------------------------------------------------------------ *
 * The staged decrypt state machine
 * ------------------------------------------------------------------ */

test('the staged decrypt: no integer exists until the search is run', async ({ page }) => {
  await openStage(page, /Decode the bounded/, '#panel-decode');

  // IDLE: nothing applied. No element, no integer.
  await expect(page.locator('#panel-decode [data-field="decode-idle"]')).toHaveCount(1);
  await expect(page.locator('#panel-decode [data-field="element"]')).toHaveCount(0);
  await expect(page.locator('#panel-decode .recovered-int')).toHaveCount(0);

  // APPLIED: decryption is complete and there is STILL no integer anywhere in
  // the panel. This is the claim the whole lab turns on.
  await page.getByRole('button', { name: 'Apply functional key' }).click();
  await expect(page.locator('#panel-decode [data-field="element"]')).toHaveCount(1);
  await expect(page.locator('#panel-decode [data-verdict="decrypt-applied"]')).toContainText(
    'DECRYPTION IS COMPLETE',
  );
  await expect(page.locator('#panel-decode .recovered-int')).toHaveCount(0);
  expect(await verdictText(page, 'search-staged')).toContain('NO INTEGER EXISTS');

  const element = await fieldText(page, '#panel-decode', 'element');
  expect(element, 'the group element must be a 32-byte encoding').toMatch(/^[0-9a-f]{64}$/);

  // DONE: now the integer exists, and it is right.
  await page.getByRole('button', { name: 'Recover the integer' }).click();
  await expect(page.locator('#panel-decode [data-verdict="decrypt-exact"]')).toContainText(
    'EXPONENT RECOVERED EXACTLY',
  );
  expect(BigInt(await fieldText(page, '#panel-decode', 'recovered'))).toBe(
    dotProduct(await readVector(page, 'x'), await readVector(page, 'y')),
  );

  // The element did not change when the integer appeared: the search reads it,
  // it does not produce it.
  expect(await fieldText(page, '#panel-decode', 'element')).toBe(element);
  expect(Number(await fieldText(page, '#panel-decode', 'search-ops'))).toBeGreaterThan(0);
});

test('the staged decrypt resets when the question changes — no stale answer', async ({ page }) => {
  await openStage(page, /Decode the bounded/, '#panel-decode');
  await runStagedDecrypt(page);
  await expect(page.locator('#panel-decode .recovered-int')).toHaveCount(1);

  // Change y. The previous answer is no longer an answer to anything on
  // screen, so it must be gone — not merely stale.
  await setVec(page, 'y', 0, '7');
  await expect(page.locator('#panel-decode [data-field="decode-idle"]')).toHaveCount(1);
  await expect(page.locator('#panel-decode .recovered-int')).toHaveCount(0);
  await expect(page.locator('#panel-decode [data-field="element"]')).toHaveCount(0);

  await runStagedDecrypt(page);
  expect(BigInt(await fieldText(page, '#panel-decode', 'recovered'))).toBe(
    dotProduct(await readVector(page, 'x'), await readVector(page, 'y')),
  );

  // Same for the bound, and for a re-encryption.
  await page.locator('#bound-slider').fill('12');
  await expect(page.locator('#panel-decode [data-field="decode-idle"]')).toHaveCount(1);
  await runStagedDecrypt(page);
  await expect(page.locator('#panel-decode .recovered-int')).toHaveCount(1);

  await page.getByRole('button', { name: 'Encrypt again' }).click();
  await expect(page.locator('#panel-decode [data-field="decode-idle"]')).toHaveCount(1);
});

test('Invariant 3: below the answer, the search refuses and prints no integer', async ({
  page,
}) => {
  const expected = dotProduct(await readVector(page, 'x'), await readVector(page, 'y'));
  expect(expected).toBe(15n);

  // With n <= 8 and entries in [-9, 9] the largest reachable product is 648,
  // inside the default bound of 1024 — so the only honest route to a refusal
  // is to lower B under the answer. The scenario bar says so.
  await page.locator('#bound-slider').fill('3');
  await expect(page.locator('#bound-readout')).toContainText('OUTSIDE that range');

  await openStage(page, /Decode the bounded/, '#panel-decode');
  await runStagedDecrypt(page);

  expect(await verdictText(page, 'range-search')).toContain('SEARCH EXHAUSTED');
  await expect(page.locator('#panel-decode .recovered-int')).toHaveCount(0);
  await expect(page.locator('#panel-decode .pending-int')).toHaveCount(1);
  // Decryption still succeeded: the element is present, the answer is not.
  await expect(page.locator('#panel-decode [data-field="element"]')).toHaveCount(1);

  const pending = (await page.locator('#panel-decode .pending-int').innerText()).trim();
  expect(pending, 'the answer slot must not contain a number').not.toMatch(/\d/);
  expect(Number(await fieldText(page, '#panel-decode', 'search-ops'))).toBeGreaterThan(0);

  // Widen it and the same product comes back.
  await page.locator('#bound-slider').fill('11');
  await runStagedDecrypt(page);
  expect(BigInt(await fieldText(page, '#panel-decode', 'recovered'))).toBe(expected);
});

test('Invariant 3: the boundary table is right at +/-B and +/-(B+1), both directions', async ({
  page,
}) => {
  await openStage(page, /Decode the bounded/, '#panel-decode');
  await openDisclosures(page, '#panel-decode');

  const rows = page
    .locator('[aria-label="Boundary behaviour of the bounded search"] table')
    .locator('tbody tr');
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const cells = rows.nth(i).locator('td');
    expect((await cells.nth(1).innerText()).trim(), `row ${i}`).toBe(
      (await cells.nth(2).innerText()).trim(),
    );
    expect(await verdictTone(page, `edge-${i}`)).toBe('ok');
  }
  expect((await rows.nth(2).locator('td').nth(1).innerText()).trim()).toBe('-25');
  expect(await verdictTone(page, 'range-edge')).toBe('ok');
});

/* ------------------------------------------------------------------ *
 * Invariant 4 — the cost law, from genuinely measured runs
 * ------------------------------------------------------------------ */

test('Invariant 4: the chart plots MEASURED runs, and they match the closed form', async ({
  page,
}) => {
  await openStage(page, /Decode the bounded/, '#panel-decode');
  // Wait for the worker's measurement rather than a timeout.
  await expect(page.locator('#panel-decode [data-verdict="cost-law"]')).toHaveAttribute(
    'data-tone',
    'ok',
  );
  await openDisclosures(page, '#panel-decode');

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
  for (const [widthS, measuredS, predictedS, refS, ratioS] of rows) {
    const width = Number(widthS);
    const measured = Number(measuredS);

    // THE POINT OF THIS TEST: the plotted number came from a search that ran,
    // and it equals what the closed form predicts. Two independent surfaces.
    expect(Number(predictedS), `predicted vs measured at W=${width}`).toBe(measured);
    expect(Number(refS)).toBeCloseTo(2 * Math.sqrt(width), 1);
    expect(Number(ratioS)).toBeCloseTo(measured / Math.sqrt(width), 3);
    ratios.push(measured / Math.sqrt(width));
  }

  const spread = Math.max(...ratios) / Math.min(...ratios);
  expect(spread, 'ops/sqrt(W) must stay flat across the sweep').toBeLessThan(1.2);
  for (const r of ratios) {
    expect(r).toBeGreaterThan(1.5);
    expect(r).toBeLessThan(2.5);
  }
  for (let i = 1; i < rows.length; i++) {
    const growth = Number(rows[i][1]) / Number(rows[i - 1][1]);
    expect(growth, `growth from row ${i - 1} to ${i}`).toBeGreaterThan(1.7);
    expect(growth).toBeLessThan(2.3);
  }

  expect(await verdictTone(page, 'cost-measured-agrees')).toBe('ok');
  expect(Number(await fieldText(page, '#panel-decode', 'ratio-spread'))).toBeCloseTo(spread, 2);
});

test('Invariant 4: the chart marks the bound the slider is on, and the row agrees', async ({
  page,
}) => {
  await openStage(page, /Decode the bounded/, '#panel-decode');
  await expect(page.locator('#panel-decode [data-verdict="cost-law"]')).toHaveAttribute(
    'data-tone',
    'ok',
  );

  // 4^5 = 1024 is one of the plotted bounds and is the shipped default, so the
  // marker has a row to line up with.
  await openDisclosures(page, '#panel-decode');
  await expect(page.locator('tr[data-row-state="current"][data-bound="1024"]')).toHaveCount(1);

  // The marker is drawn in the SVG.
  expect(
    await page.locator('#panel-decode svg text', { hasText: 'B now' }).count(),
    'the chart must mark the current bound',
  ).toBe(1);

  // Move the slider to another plotted bound and the marked row moves with it.
  await page.locator('#bound-slider').fill('12'); // 4096
  await openDisclosures(page, '#panel-decode');
  await expect(page.locator('tr[data-row-state="current"][data-bound="4096"]')).toHaveCount(1);
  await expect(page.locator('tr[data-row-state="current"][data-bound="1024"]')).toHaveCount(0);

  // The measured row for that bound is the WORST case; a live search finds its
  // answer early, so it costs no more. That is the relationship — asserting
  // equality here would be asserting the wrong thing.
  const measured = Number(await fieldText(page, '#panel-decode', 'measured-4096'));
  await runStagedDecrypt(page);
  const actualOps = Number(await fieldText(page, '#panel-decode', 'search-ops'));
  expect(actualOps).toBeLessThanOrEqual(measured + 2);
});

/* ------------------------------------------------------------------ *
 * Stage 3 — knowledge accumulates, in EVERY order
 * ------------------------------------------------------------------ */

test('Stage 3: every request ORDER is truthful at every rank', async ({ page }) => {
  // The defect this replaces was reachable in 7 of the 15 key subsets, and the
  // old test only ever clicked "the first available button" — one of 24
  // orders. This drives several distinct orders through the real UI, including
  // the one that starts with the key that used to trigger the false red.
  const orders: number[][] = [
    [0, 1, 2, 3],
    [2, 0, 1, 3],
    [3, 2, 1, 0],
    [2, 3, 0, 1],
  ];

  for (const order of orders) {
    await page.goto('.');
    await openStage(page, /Watch knowledge/, '#panel-accumulate');

    for (let k = 0; k < order.length; k++) {
      await page.locator(`#panel-accumulate button[data-request-key="${order[k]}"]`).click();
      await expect(page.locator('#panel-accumulate [data-verdict^="offer-"]')).toHaveCount(k + 1);

      const label = `order [${order.join('')}] after ${k + 1}`;
      if (k + 1 < 4) {
        // Two generated candidates, BOTH consistent, at every rank below n.
        // No legal interaction may produce an internal-error verdict.
        expect(await verdictTone(page, 'cand-a'), `${label}: candidate A`).toBe('ok');
        expect(await verdictTone(page, 'cand-b'), `${label}: candidate B`).toBe('ok');
        expect(await verdictTone(page, 'two-candidates'), `${label}: pair`).toBe('ok');
        const pairText = await verdictText(page, 'two-candidates');
        expect(pairText, `${label}: must not report an internal error`).not.toContain(
          'BOOKKEEPING IS WRONG',
        );
        expect(pairText).toContain('x IS NOT DETERMINED');

        const a = await fieldText(page, '#panel-accumulate', 'candidate-a');
        const b = await fieldText(page, '#panel-accumulate', 'candidate-b');
        expect(a, `${label}: candidates must differ`).not.toBe(b);
      } else {
        expect(await verdictText(page, 'partial')).toContain('x IS NOW DETERMINED');
        expect(await verdictTone(page, 'reconstruct')).toBe('ok');
        // No candidate pair survives a pinned state.
        await expect(page.locator('#panel-accumulate [data-verdict="cand-a"]')).toHaveCount(0);
      }
    }
  }
});

test('Stage 3: the matrix reports what each key bought, and the ranks add up', async ({ page }) => {
  await openStage(page, /Watch knowledge/, '#panel-accumulate');

  for (let k = 0; k < 4; k++) {
    await page.locator('#panel-accumulate button[data-request-key]').first().click();
    await expect(page.locator('#panel-accumulate [data-verdict^="offer-"]')).toHaveCount(k + 1);

    const rankText = await fieldText(page, '#panel-accumulate', 'acc-rank');
    const held = Number(await fieldText(page, '#panel-accumulate', 'acc-held'));
    const free = await fieldText(page, '#panel-accumulate', 'acc-free');

    expect(held, 'keys held must equal the rows issued').toBe(k + 1);
    const rank = Number(rankText.split(' ')[0]);
    expect(rank + Number(free.split(' ')[0]), 'rank + free must equal n').toBe(4);

    // The number of rows the matrix marks independent must equal the rank.
    const independent = await page
      .locator('#panel-accumulate table.matrix tbody tr[data-independent="true"]')
      .count();
    expect(independent, 'independent rows must equal the rank').toBe(rank);
  }
});

test('Stage 3: returning the keys retires the reconstruction, and re-returning is a no-op', async ({
  page,
}) => {
  await openStage(page, /Watch knowledge/, '#panel-accumulate');
  for (let i = 0; i < 4; i++) {
    await page.locator('#panel-accumulate button[data-request-key]').first().click();
  }
  expect(await verdictText(page, 'partial')).toContain('x IS NOW DETERMINED');

  // RETIREMENT: the recovered x must be gone, not stale.
  await page.getByRole('button', { name: 'Return all keys' }).click();
  await expect(page.locator('#panel-accumulate [data-verdict="reconstruct"]')).toHaveCount(0);
  await expect(page.locator('#panel-accumulate [data-field="reconstructed"]')).toHaveCount(0);
  expect(await verdictText(page, 'partial')).toContain('4 FREE DIMENSIONS REMAIN');

  // NO-OP GUARD: returning again changes nothing and fabricates no verdict.
  await page.getByRole('button', { name: 'Return all keys' }).click();
  expect(await verdictText(page, 'partial')).toContain('4 FREE DIMENSIONS REMAIN');
  await expect(page.locator('#panel-accumulate [data-verdict="reconstruct"]')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * Stage 4 — the issuance gate, the refusal, and the master secret
 * ------------------------------------------------------------------ */

test('Stage 4: a rank-deficient set is refused, with the rank shown and no s printed', async ({
  page,
}) => {
  await openStage(page, /Cross the authorization/, '#panel-cross');
  expect(await verdictText(page, 'rank-refusal')).toContain('RANK 0 OF 4');

  for (let i = 0; i < 4; i++) {
    await page.locator('#panel-cross button[data-request-alone]').first().click();
    await expect(page.locator('#panel-cross [data-verdict^="alone-offer-"]')).toHaveCount(i + 1);
  }

  const text = await verdictText(page, 'rank-refusal');
  expect(text).toContain('RANK 2 OF 4');
  expect(text).toContain('RECOVERY REFUSED');
  await expect(page.locator('#panel-cross [data-verdict="master"]')).toHaveCount(0);
  const panel = await page.locator('#panel-cross').innerText();
  expect(panel, 'a refused recovery must not print a candidate s').not.toMatch(/s recovered/i);
});

test('Stage 4: the policy gate blocks the key that completes a basis until overridden', async ({
  page,
}) => {
  await openStage(page, /Cross the authorization/, '#panel-cross');
  for (let i = 0; i < 5; i++) {
    await page.locator('#panel-cross button[data-request-alone]').first().click();
    await expect(page.locator('#panel-cross [data-verdict^="alone-offer-"]')).toHaveCount(i + 1);
  }

  // One key away from full rank: the dangerous request is identified by name
  // and its Issue button is disabled.
  expect(await verdictText(page, 'policy-gate')).toContain('HELD');
  await expect(page.locator('#panel-cross [data-field="completes-basis"]')).toContainText(
    'completes a basis',
  );
  await expect(page.locator('#panel-cross button[data-deny]')).toBeDisabled();
  await expect(page.locator('#panel-cross [data-verdict="master"]')).toHaveCount(0);

  // The override is explicit, and only then can it be issued.
  await page.getByRole('button', { name: 'Issue it anyway' }).click();
  expect(await verdictText(page, 'policy-gate')).toContain('OVERRIDDEN');
  await page.locator('#panel-cross button[data-request-alone]').first().click();
  expect(await verdictText(page, 'rank-refusal')).toContain('s RECOVERED');
});

test('Stage 4: the forged key decrypts a fresh ciphertext, and the scoping survives', async ({
  page,
}) => {
  await openStage(page, /Cross the authorization/, '#panel-cross');
  for (let i = 0; i < 5; i++) {
    await page.locator('#panel-cross button[data-request-alone]').first().click();
  }
  await page.getByRole('button', { name: 'Issue it anyway' }).click();
  await page.locator('#panel-cross button[data-request-alone]').first().click();

  expect(await verdictTone(page, 'master')).toBe('ok');
  expect(await verdictTone(page, 'never-issued')).toBe('ok');
  expect(await fieldText(page, '#panel-cross', 'computed')).toBe(
    await fieldText(page, '#panel-cross', 'expected'),
  );

  // The forged scalar equals the authority's own, shown side by side.
  await openDisclosures(page, '#panel-cross');
  const scalars = await page
    .locator('#panel-cross .alarm-box .group-el')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  expect(scalars.length).toBeGreaterThanOrEqual(2);
  expect(scalars[0], "forged sk_y must equal the authority's").toBe(scalars[1]);

  // The scoping sentence — the claim most at risk of widening into "IPFE is
  // broken" — must be present.
  const notClaimed = await fieldText(page, '#panel-cross', 'not-claimed');
  expect(notClaimed).toContain('adaptively secure');
  expect(notClaimed.toLowerCase()).toContain('collusion is harmless');
  expect(await fieldText(page, '#panel-cross', 'why-permitted')).toMatch(/only constrains keys/i);
});

/* ------------------------------------------------------------------ *
 * Evidence
 * ------------------------------------------------------------------ */

test('the fixtures table prints both values on EVERY row and reports the wrong one failing', async ({
  page,
}) => {
  await openStage(page, /Evidence/, '#panel-evidence');

  const rows = await page.locator('#panel-evidence tbody tr[data-fixture]').evaluateAll((trs) =>
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
    expect(computed, `${r.fixture}: computed printed`).not.toBe('');
    expect(claimed, `${r.fixture}: claimed printed`).not.toBe('');
    expect(BigInt(computed), `${r.fixture}: scheme vs test dot product`).toBe(dotProduct(x, y));
    const agrees = computed === claimed;
    expect(r.state).toBe(agrees ? 'pass' : 'fail');
    expect(await verdictTone(page, `fixture-${r.fixture}`)).toBe(agrees ? 'ok' : 'fail');
    if (!agrees) failing++;
  }

  expect(failing, 'exactly one fixture must be reported as disagreeing').toBe(1);
  const wrong = rows.find((r) => r.state === 'fail');
  expect(wrong?.fixture).toBe('wrong-on-purpose');
  expect(wrong?.cells[4]).toBe('15');
  expect(wrong?.cells[5]).toBe('16');
});

test('4.1d negative claim: every check is green AND the property is violated anyway', async ({
  page,
}) => {
  // 1. REACH THE FIXTURE through the UI.
  await openStage(page, /Evidence/, '#panel-evidence');

  // 3. THE LIMITATION IS ON SCREEN — and NOT behind a disclosure. Asserted
  //    before anything is opened, because section 4.1d requires exactly that.
  const claim = await fieldText(page, '#panel-evidence', 'negative-claim');
  expect(claim).toContain('additively malleable');
  expect(claim).toMatch(/no integrity/i);
  expect(claim).toMatch(/decryption cannot tell/i);
  await expect(page.locator('#panel-evidence [data-field="negative-claim"]')).toBeVisible();
  expect(await verdictText(page, 'negative-claim-verdict')).toContain('DECRYPTED — AND MODIFIED');

  // 2. EVERYTHING IS GREEN, asserted against the rendered verdicts.
  await openDisclosures(page, '#panel-evidence');
  for (const id of ['maul-decrypts', 'maul-correct', 'maul-undetected']) {
    expect(await verdictTone(page, id), `${id} must report success`).toBe('ok');
  }

  const cells = await page
    .locator('[aria-label="Malleability exhibit"] table tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()),
      ),
    );
  const original = BigInt(cells[0][1]);
  const mauled = BigInt(cells[1][1]);
  const expectedSum = BigInt(cells[2][1]);
  expect(mauled).toBe(expectedSum);
  expect(mauled, 'the answer must have moved, or nothing was demonstrated').not.toBe(original);

  const panel = await page.locator('#panel-evidence').innerText();
  expect(panel).toMatch(/absence of a failure code is the exhibit/i);
});

test('4.1d: the honesty panel scopes what is NOT built and names the selective/adaptive gap', async ({
  page,
}) => {
  await openStage(page, /Evidence/, '#panel-evidence');
  const panel = await page.locator('#panel-evidence').innerText();
  expect(panel).toMatch(/selective/i);
  expect(panel).toMatch(/ALS16/);
  expect(panel).toMatch(/Paillier/);
  expect(panel).toMatch(/not production/i);
});

/* ------------------------------------------------------------------ *
 * Randomized encryption, and the element that does NOT move
 * ------------------------------------------------------------------ */

test('Invariant 2: a fresh encryption changes every ciphertext component', async ({ page }) => {
  await openStage(page, /Decode the bounded/, '#panel-decode');
  await openDisclosures(page, '#panel-decode');
  expect(await verdictTone(page, 'randomized')).toBe('info');

  const before = await page
    .locator('#panel-decode .group-el')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));

  await page.getByRole('button', { name: 'Encrypt again' }).click();
  await openDisclosures(page, '#panel-decode');

  expect(await verdictTone(page, 'randomized')).toBe('ok');
  expect(await verdictTone(page, 'component-ct0')).toBe('ok');
  for (let i = 0; i < 4; i++) {
    expect(await verdictTone(page, `component-${i}`), `ct_${i + 1}`).toBe('ok');
  }

  const now = [await fieldText(page, '#panel-decode', 'ct0-now')];
  for (let i = 0; i < 4; i++) now.push(await fieldText(page, '#panel-decode', `ct-now-${i}`));
  expect(new Set(now).size, 'the five components must be distinct').toBe(5);
  for (const v of now) expect(before, `component ${v} repeated`).not.toContain(v);
});

test('Invariant 2: the decrypted element is UNCHANGED by re-encryption — the r cancels', async ({
  page,
}) => {
  // The half a test is most likely to get backwards: g^<x,y> is deterministic.
  // A test asserting the element changes would be asserting the scheme broken.
  await openStage(page, /Decode the bounded/, '#panel-decode');
  await page.getByRole('button', { name: 'Apply functional key' }).click();
  const element = await fieldText(page, '#panel-decode', 'element');

  await page.getByRole('button', { name: 'Encrypt again' }).click();
  await page.getByRole('button', { name: 'Apply functional key' }).click();

  expect(await fieldText(page, '#panel-decode', 'element')).toBe(element);
});

/* ------------------------------------------------------------------ *
 * Navigation, URL state, and the [hidden] probe
 * ------------------------------------------------------------------ */

test('URL hashes address stages, and back/forward move between them', async ({ page }) => {
  await expect(page.getByRole('tab', { name: /Ask one question/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await openStage(page, /Watch knowledge/, '#panel-accumulate');
  expect(new URL(page.url()).hash).toBe('#accumulate');

  await openStage(page, /Cross the authorization/, '#panel-cross');
  expect(new URL(page.url()).hash).toBe('#cross');

  // BACK returns to the previous stage rather than leaving the page.
  await page.goBack();
  await expect(page.getByRole('tab', { name: /Watch knowledge/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#panel-accumulate')).not.toBeEmpty();

  await page.goForward();
  await expect(page.getByRole('tab', { name: /Cross the authorization/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // A deep link lands on the right stage, rendered.
  await page.goto('./#evidence');
  await expect(page.getByRole('tab', { name: /Evidence/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-evidence')).not.toBeEmpty();

  // An unknown hash falls back to the first stage rather than a blank page.
  await page.goto('./#not-a-stage');
  await expect(page.getByRole('tab', { name: /Ask one question/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#panel-ask')).not.toBeEmpty();
});

test('the pager walks every stage forward and back', async ({ page }) => {
  const titles = [
    /Ask one question/,
    /Decode the bounded/,
    /Watch knowledge/,
    /Cross the authorization/,
    /Evidence/,
  ];
  await expect(page.locator('#btn-prev')).toBeDisabled();
  for (let i = 1; i < titles.length; i++) {
    await page.locator('#btn-next').click();
    await expect(page.getByRole('tab', { name: titles[i] })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await expect(page.locator('#btn-next')).toBeDisabled();
  for (let i = titles.length - 2; i >= 0; i--) {
    await page.locator('#btn-prev').click();
    await expect(page.getByRole('tab', { name: titles[i] })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await expect(page.locator('#btn-prev')).toBeDisabled();
});

test('[hidden] means hidden: no class rule outranks the UA rule', async ({ page }) => {
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

  for (const id of ['decode', 'accumulate', 'cross', 'evidence']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).toBeEmpty();
  }

  // Disclosures ship SHUT, so the default reading path is the short one.
  await expect(page.locator('#panel-ask details.disclose[open]')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * Cross-checks between surfaces
 * ------------------------------------------------------------------ */

test('cross-check: the dimension select changes the vectors and both columns follow', async ({
  page,
}) => {
  for (const n of ['1', '4', '8']) {
    await page.locator('#n-select').selectOption(n);
    await expect(page.locator('input[data-vec="x"]')).toHaveCount(Number(n));
    await expect(page.locator('input[data-vec="y"]')).toHaveCount(Number(n));

    const x = await readVector(page, 'x');
    const y = await readVector(page, 'y');
    expect(BigInt(await fieldText(page, '#panel-ask', 'computed'))).toBe(dotProduct(x, y));
    // The authority column runs n basis-key decryptions at this dimension.
    expect(await fieldText(page, '#panel-ask', 'authority-vector')).toBe(`(${x.join(', ')})`);
    expect(await verdictTone(page, 'authority-recovery')).toBe('ok');
  }
});

test('cross-check: the scenario readout agrees with the slider at every stop', async ({ page }) => {
  for (const [exp, bound] of [
    ['3', 8n],
    ['10', 1024n],
    ['16', 65536n],
    ['21', 2097152n],
  ] as const) {
    await page.locator('#bound-slider').fill(exp);
    const readout = await page.locator('#bound-readout').innerText();
    expect(readout).toContain(`B = ${bound};`);
    expect(readout).toContain(`width W = ${2n * bound + 1n}`);
  }
});

test('edge case 5: the functional key is a canonical scalar mod l', async ({ page }) => {
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;
  for (const [i, v] of ['-9', '-9', '-9', '-9'].entries()) await setVec(page, 'y', i, v);

  await openDisclosures(page, '#panel-ask');
  const sk = BigInt(await fieldText(page, '#panel-ask', 'sk'));
  expect(sk).toBeGreaterThanOrEqual(0n);
  expect(sk).toBeLessThan(L);
  expect(await verdictTone(page, 'scalar-canonical')).toBe('ok');
  expect(BigInt(await fieldText(page, '#panel-ask', 'computed'))).toBe(
    dotProduct(await readVector(page, 'x'), await readVector(page, 'y')),
  );
});

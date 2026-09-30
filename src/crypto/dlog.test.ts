/**
 * BSGS over a symmetric range: correctness at the edges, and the cost law.
 */

import { describe, it, expect } from 'vitest';
import { MAX_BOUND, ceilSqrt, dlogSymmetric, tableSizeFor, worstCaseOps } from './dlog';
import { scalarMulBase, GENERATOR, IDENTITY, equals } from './ristretto';
import { COST_LAW_BOUNDS } from './fixtures';

describe('ceilSqrt', () => {
  it('is exact on perfect squares and rounds up otherwise', () => {
    expect(ceilSqrt(0n)).toBe(0n);
    expect(ceilSqrt(1n)).toBe(1n);
    expect(ceilSqrt(2n)).toBe(2n);
    expect(ceilSqrt(4n)).toBe(2n);
    expect(ceilSqrt(5n)).toBe(3n);
    expect(ceilSqrt(9n)).toBe(3n);
    expect(ceilSqrt(10n)).toBe(4n);
    expect(ceilSqrt(10_000n)).toBe(100n);
    expect(ceilSqrt(10_001n)).toBe(101n);
  });

  it('satisfies its defining property over a wide sweep', () => {
    for (let k = 0n; k < 400n; k++) {
      const r = ceilSqrt(k);
      expect(r * r).toBeGreaterThanOrEqual(k);
      if (r > 0n) expect((r - 1n) * (r - 1n)).toBeLessThan(k);
    }
  });

  it('refuses a negative input', () => {
    expect(() => ceilSqrt(-1n)).toThrow();
  });
});

describe('finding every value in range', () => {
  it('recovers every m in [-B, B] for a small B, including both edges and 0', () => {
    const B = 40n;
    for (let m = -B; m <= B; m++) {
      const r = dlogSymmetric(scalarMulBase(m), B);
      expect(r.found).toBe(true);
      if (r.found) expect(r.value).toBe(m);
    }
  });

  it('the identity resolves to 0, not to a failure', () => {
    const r = dlogSymmetric(IDENTITY, 10n);
    expect(r.found).toBe(true);
    if (r.found) expect(r.value).toBe(0n);
  });

  it('B = 0 searches exactly {0}', () => {
    const zero = dlogSymmetric(IDENTITY, 0n);
    expect(zero.found).toBe(true);
    if (zero.found) expect(zero.value).toBe(0n);
    expect(dlogSymmetric(GENERATOR, 0n).found).toBe(false);
  });

  it('the symmetric range is genuinely symmetric: -m works wherever m does', () => {
    const B = 100n;
    for (const m of [1n, 7n, 63n, 99n, 100n]) {
      const pos = dlogSymmetric(scalarMulBase(m), B);
      const neg = dlogSymmetric(scalarMulBase(-m), B);
      expect(pos.found).toBe(true);
      expect(neg.found).toBe(true);
      if (pos.found) expect(pos.value).toBe(m);
      if (neg.found) expect(neg.value).toBe(-m);
    }
  });
});

describe('Invariant 3 — never a wrapped answer', () => {
  it('values just outside the range are reported not found, both signs', () => {
    const B = 50n;
    for (const m of [B + 1n, B + 2n, -(B + 1n), -(B + 2n), 5000n, -5000n]) {
      const r = dlogSymmetric(scalarMulBase(m), B);
      expect(r.found).toBe(false);
      if (!r.found) expect(r.reason).toBe('not-found-in-range');
    }
  });

  it('a near-miss does not return the wrong in-range value', () => {
    // Exhaustive at the boundary: for every m outside [-B, B] up to 3B, the
    // search must fail rather than return some other integer.
    const B = 25n;
    for (let m = B + 1n; m <= 3n * B; m++) {
      expect(dlogSymmetric(scalarMulBase(m), B).found).toBe(false);
      expect(dlogSymmetric(scalarMulBase(-m), B).found).toBe(false);
    }
  });

  it('refuses a bound past the measured in-browser cap', () => {
    expect(() => dlogSymmetric(GENERATOR, MAX_BOUND + 1n)).toThrow(/cap/);
    expect(() => dlogSymmetric(IDENTITY, -1n)).toThrow();
  });
});

describe('Invariant 4 — the cost law', () => {
  /**
   * `worstCaseOps` predicts the cost from B alone; the search charges what it
   * actually does. These are two independent surfaces and they must agree, so
   * the chart cannot be plotting a number the code never pays.
   */
  it('the predicted worst case equals the charged cost of a failed search', () => {
    for (const B of [1n, 5n, 16n, 63n, 64n, 100n, 255n, 256n, 1024n]) {
      // A target far outside the range forces the search to run to completion.
      const r = dlogSymmetric(scalarMulBase(10n ** 12n), B);
      expect(r.found).toBe(false);
      const predicted = worstCaseOps(B);
      expect(r.ops.babySteps).toBe(predicted.babySteps);
      expect(r.ops.giantSteps).toBe(predicted.giantSteps);
      expect(r.ops.setup).toBe(predicted.setup);
      expect(r.ops.total).toBe(predicted.total);
      expect(r.tableSize).toBe(Number(tableSizeFor(B)));
    }
  });

  it('total is the sum of its parts', () => {
    for (const B of COST_LAW_BOUNDS) {
      const o = worstCaseOps(B);
      expect(o.total).toBe(o.setup + o.babySteps + o.giantSteps);
    }
  });

  /**
   * The law itself. Width W = 2B+1; the search stores ceil(sqrt(W)) baby steps
   * and walks about the same number of giant steps, so ops/sqrt(W) should sit
   * near 2 and stay there as W grows over four orders of magnitude.
   */
  it('group ops grow as Theta(sqrt(W)): ops/sqrt(W) stays within tolerance', () => {
    const ratios = COST_LAW_BOUNDS.map((B) => {
      const W = 2n * B + 1n;
      const ops = worstCaseOps(B);
      // Compare only the search cost against sqrt(W). The two setup scalar
      // multiplications are O(log B) and are excluded on purpose.
      const searchOps = ops.babySteps + ops.giantSteps;
      return searchOps / Math.sqrt(Number(W));
    });

    expect(ratios.length).toBeGreaterThanOrEqual(3);
    for (const r of ratios) {
      expect(r).toBeGreaterThan(1.5);
      expect(r).toBeLessThan(2.5);
    }
    // And the spread across the whole sweep is small: a linear cost would blow
    // this apart immediately.
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    expect(max / min).toBeLessThan(1.2);
  });

  it('quadrupling the width roughly doubles the cost, never quadruples it', () => {
    for (let i = 1; i < COST_LAW_BOUNDS.length; i++) {
      const prev = worstCaseOps(COST_LAW_BOUNDS[i - 1]);
      const cur = worstCaseOps(COST_LAW_BOUNDS[i]);
      const prevSearch = prev.babySteps + prev.giantSteps;
      const curSearch = cur.babySteps + cur.giantSteps;
      const growth = curSearch / prevSearch;
      // sqrt(4) = 2. A linear law would give 4.
      expect(growth).toBeGreaterThan(1.7);
      expect(growth).toBeLessThan(2.3);
    }
  });

  it('a real successful search never costs more than the worst case', () => {
    const B = 1024n;
    const worst = worstCaseOps(B);
    for (const m of [0n, 1n, -1n, 500n, -500n, 1024n, -1024n]) {
      const r = dlogSymmetric(scalarMulBase(m), B);
      expect(r.found).toBe(true);
      expect(r.ops.total).toBeLessThanOrEqual(worst.total);
    }
  });
});

describe('the table', () => {
  it('table size is ceil(sqrt(2B+1))', () => {
    for (const B of [0n, 1n, 4n, 12n, 100n, 1024n]) {
      expect(tableSizeFor(B)).toBe(ceilSqrt(2n * B + 1n));
    }
  });

  it('the largest offered bound stays tractable in-browser', () => {
    const o = worstCaseOps(MAX_BOUND);
    // The cap exists so this number stays in the low thousands. If a future
    // change raises MAX_BOUND without measuring, this fails.
    expect(o.total).toBeLessThan(12000);
    expect(Number(tableSizeFor(MAX_BOUND))).toBeLessThan(4000);
  });
});

describe('the searched element', () => {
  it('a found value really is the exponent, checked by re-exponentiating', () => {
    const B = 200n;
    for (const m of [0n, 3n, -3n, 199n, -200n]) {
      const target = scalarMulBase(m);
      const r = dlogSymmetric(target, B);
      expect(r.found).toBe(true);
      if (r.found) expect(equals(scalarMulBase(r.value), target)).toBe(true);
    }
  });
});

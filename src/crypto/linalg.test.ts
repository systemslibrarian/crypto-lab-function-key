/**
 * Exact linear algebra. The checks that matter here are the ones a float
 * implementation would fail.
 */

import { describe, it, expect } from 'vitest';
import {
  fAdd,
  fDiv,
  fEq,
  fIsInteger,
  fMul,
  fSub,
  fToString,
  frac,
  invMod,
  modularRank,
  rationalRank,
  solveModular,
  solveRational,
  type Frac,
} from './linalg';
import { GROUP_ORDER } from './ristretto';

describe('rationals', () => {
  it('normalizes sign and reduces to lowest terms', () => {
    expect(frac(4n, 8n)).toEqual({ num: 1n, den: 2n });
    expect(frac(-4n, 8n)).toEqual({ num: -1n, den: 2n });
    expect(frac(4n, -8n)).toEqual({ num: -1n, den: 2n });
    expect(frac(-4n, -8n)).toEqual({ num: 1n, den: 2n });
    expect(frac(0n, 5n)).toEqual({ num: 0n, den: 1n });
  });

  it('refuses a zero denominator rather than producing Infinity', () => {
    expect(() => frac(1n, 0n)).toThrow(/zero denominator/);
    expect(() => fDiv(frac(1n), frac(0n))).toThrow(/division by zero/);
  });

  it('arithmetic is exact where floats are not', () => {
    // 1/3 + 1/3 + 1/3 is exactly 1 here. In doubles it is 1 only by luck of
    // rounding, and 0.1+0.2 is the standard counterexample.
    const third = frac(1n, 3n);
    expect(fEq(fAdd(fAdd(third, third), third), frac(1n))).toBe(true);
    const tenth = frac(1n, 10n);
    const fifth = frac(1n, 5n);
    expect(fEq(fAdd(tenth, fifth), frac(3n, 10n))).toBe(true);
    expect(0.1 + 0.2).not.toBe(0.3); // the float the code refuses to use
  });

  it('subtraction of equal values is exactly zero', () => {
    const a = frac(7n, 13n);
    expect(fSub(a, a)).toEqual({ num: 0n, den: 1n });
  });

  it('handles values far outside double precision', () => {
    const big = frac(10n ** 40n + 1n, 3n);
    const back = fDiv(fMul(big, frac(3n)), frac(3n));
    expect(fEq(back, big)).toBe(true);
    expect(fMul(big, frac(3n))).toEqual({ num: 10n ** 40n + 1n, den: 1n });
  });

  it('renders as a reader expects', () => {
    expect(fToString(frac(3n))).toBe('3');
    expect(fToString(frac(-1n))).toBe('-1');
    expect(fToString(frac(7n, 2n))).toBe('7/2');
    expect(fToString(frac(-7n, 2n))).toBe('-7/2');
    expect(fIsInteger(frac(4n, 2n))).toBe(true);
    expect(fIsInteger(frac(7n, 2n))).toBe(false);
  });
});

describe('solveRational', () => {
  it('finds the unique solution of a full-rank system', () => {
    // 2a +  b = 5
    //  a - 3b = -1   =>  a = 2, b = 1
    const sol = solveRational([[2n, 1n], [1n, -3n]], [5n, -1n], 2);
    expect(sol.kind).toBe('solutions');
    if (sol.kind !== 'solutions') return;
    expect(sol.dimension).toBe(0);
    expect(sol.rank).toBe(2);
    expect(sol.particular.map(fToString)).toEqual(['2', '1']);
    expect(sol.nullSpace).toHaveLength(0);
  });

  it('returns non-integer solutions exactly, as fractions', () => {
    // 2a = 7  =>  a = 7/2, not 3 and not 3.5
    const sol = solveRational([[2n]], [7n], 1);
    expect(sol.kind).toBe('solutions');
    if (sol.kind !== 'solutions') return;
    expect(sol.particular[0]).toEqual({ num: 7n, den: 2n });
    expect(fToString(sol.particular[0])).toBe('7/2');
  });

  it('reports the affine family when rank < cols, with the right dimension', () => {
    // One equation in three unknowns: a 2-dimensional solution set.
    const sol = solveRational([[1n, 1n, 1n]], [6n], 3);
    expect(sol.kind).toBe('solutions');
    if (sol.kind !== 'solutions') return;
    expect(sol.rank).toBe(1);
    expect(sol.dimension).toBe(2);
    expect(sol.nullSpace).toHaveLength(2);

    // Every basis vector must actually be in the null space, and the particular
    // solution must actually satisfy the equation. Checked here, not assumed.
    const dot = (v: readonly Frac[]) => v.reduce((acc, f) => fAdd(acc, f), frac(0n));
    expect(fEq(dot(sol.particular), frac(6n))).toBe(true);
    for (const v of sol.nullSpace) expect(fEq(dot(v), frac(0n))).toBe(true);
  });

  it('every point of the reported family satisfies the original system', () => {
    // 1a + 2b + 0c = 4
    // 0a + 1b + 1c = 3
    const A = [[1n, 2n, 0n], [0n, 1n, 1n]];
    const b = [4n, 3n];
    const sol = solveRational(A, b, 3);
    expect(sol.kind).toBe('solutions');
    if (sol.kind !== 'solutions') return;
    expect(sol.dimension).toBe(1);

    const evaluate = (z: readonly Frac[], row: readonly bigint[]) =>
      row.reduce((acc, coeff, i) => fAdd(acc, fMul(frac(coeff), z[i])), frac(0n));

    // Sample the family at several coefficients, including negative ones.
    for (const t of [0n, 1n, -1n, 5n, -7n]) {
      const point = sol.particular.map((p, i) =>
        fAdd(p, fMul(frac(t), sol.nullSpace[0][i])),
      );
      A.forEach((row, r) => {
        expect(fEq(evaluate(point, row), frac(b[r]))).toBe(true);
      });
    }
  });

  it('detects an inconsistent system rather than returning a nearest fit', () => {
    //  a + b = 1
    //  a + b = 2   =>  no solution
    const sol = solveRational([[1n, 1n], [1n, 1n]], [1n, 2n], 2);
    expect(sol.kind).toBe('inconsistent');
  });

  it('a duplicate row adds no rank', () => {
    const sol = solveRational([[1n, 1n], [1n, 1n]], [1n, 1n], 2);
    expect(sol.kind).toBe('solutions');
    if (sol.kind !== 'solutions') return;
    expect(sol.rank).toBe(1);
    expect(sol.dimension).toBe(1);
  });

  it('more rows than columns is fine when they are consistent', () => {
    const sol = solveRational([[1n, 0n], [0n, 1n], [1n, 1n]], [2n, 3n, 5n], 2);
    expect(sol.kind).toBe('solutions');
    if (sol.kind !== 'solutions') return;
    expect(sol.dimension).toBe(0);
    expect(sol.particular.map(fToString)).toEqual(['2', '3']);
  });

  it('checks its own argument shapes', () => {
    expect(() => solveRational([[1n, 1n]], [1n, 2n], 2)).toThrow(/b has length/);
    expect(() => solveRational([[1n, 1n, 1n]], [1n], 2)).toThrow(/row 0 has length/);
  });
});

describe('rationalRank', () => {
  it('counts independent rows, not rows', () => {
    expect(rationalRank([], 3)).toBe(0);
    expect(rationalRank([[1n, 0n, 0n]], 3)).toBe(1);
    expect(rationalRank([[1n, 0n, 0n], [2n, 0n, 0n]], 3)).toBe(1);
    expect(rationalRank([[1n, 0n, 0n], [0n, 1n, 0n]], 3)).toBe(2);
    expect(rationalRank([[1n, 1n, 0n], [0n, 1n, 1n], [1n, 2n, 1n]], 3)).toBe(2);
  });

  it('a scalar multiple with a large factor still adds no rank', () => {
    // This is the case a float rank test gets wrong in the other direction:
    // large magnitudes make the "zero" pivot non-zero in floating point.
    expect(rationalRank([[1n, 1n], [10n ** 20n, 10n ** 20n]], 2)).toBe(1);
  });
});

describe('modular arithmetic mod l', () => {
  it('invMod inverts, including for values near the modulus', () => {
    for (const a of [1n, 2n, 3n, 7n, 12345n, GROUP_ORDER - 1n, GROUP_ORDER - 2n]) {
      expect((a * invMod(a)) % GROUP_ORDER).toBe(1n);
    }
  });

  it('invMod handles negative input by reducing first', () => {
    expect((-5n * invMod(-5n)) % GROUP_ORDER + GROUP_ORDER).toBeGreaterThan(0n);
    const inv = invMod(-5n);
    const prod = ((-5n * inv) % GROUP_ORDER + GROUP_ORDER) % GROUP_ORDER;
    expect(prod).toBe(1n);
  });

  it('0 has no inverse and says so', () => {
    expect(() => invMod(0n)).toThrow(/no inverse/);
    expect(() => invMod(GROUP_ORDER)).toThrow(/no inverse/);
  });
});

describe('solveModular', () => {
  it('solves a full-rank system mod l', () => {
    const sol = solveModular([[1n, 1n], [1n, -1n]], [10n, 2n], 2);
    expect(sol.kind).toBe('unique');
    if (sol.kind !== 'unique') return;
    expect(sol.solution).toEqual([6n, 4n]);
    expect(sol.rank).toBe(2);
  });

  it('handles solutions that are only expressible mod l', () => {
    // 2z = 1 mod l has the unique solution (l+1)/2, which is not an integer
    // solution at all. Reporting it as 0 or 1 would be wrong.
    const sol = solveModular([[2n]], [1n], 1);
    expect(sol.kind).toBe('unique');
    if (sol.kind !== 'unique') return;
    expect((2n * sol.solution[0]) % GROUP_ORDER).toBe(1n);
    expect(sol.solution[0]).toBe((GROUP_ORDER + 1n) / 2n);
  });

  it('refuses an underdetermined system and reports the rank', () => {
    const sol = solveModular([[1n, 1n], [2n, 2n]], [3n, 6n], 2);
    expect(sol.kind).toBe('underdetermined');
    if (sol.kind !== 'underdetermined') return;
    expect(sol.rank).toBe(1);
  });

  it('detects inconsistency mod l', () => {
    const sol = solveModular([[1n, 1n], [2n, 2n]], [3n, 7n], 2);
    expect(sol.kind).toBe('inconsistent');
    if (sol.kind !== 'inconsistent') return;
    expect(sol.rank).toBe(1);
  });

  it('reduces negative coefficients into [0, l)', () => {
    const sol = solveModular([[-1n, 0n], [0n, -1n]], [-3n, -4n], 2);
    expect(sol.kind).toBe('unique');
    if (sol.kind !== 'unique') return;
    expect(sol.solution).toEqual([3n, 4n]);
  });

  it('modularRank agrees with rationalRank on this lab\'s small entries', () => {
    // They answer different questions and CAN differ, but not at entries this
    // small: a relation with coefficients divisible by l is unreachable here.
    const sets: (readonly bigint[])[][] = [
      [[1n, 1n, 0n], [0n, 1n, 1n]],
      [[1n, 1n, 0n], [2n, 2n, 0n]],
      [[9n, -9n, 3n], [-3n, 3n, -1n]],
      [[1n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]],
    ];
    for (const s of sets) {
      expect(modularRank(s, 3)).toBe(rationalRank(s, 3));
    }
  });
});

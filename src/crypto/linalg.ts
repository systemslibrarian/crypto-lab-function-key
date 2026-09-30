/**
 * Exact linear algebra: rationals over Q with BigInt fractions, and elimination
 * mod l. No floating point anywhere in this file, by design.
 *
 * Why that matters enough to be an invariant. The analyst's whole claim is
 * "these k outputs pin x to exactly this affine set." A float pivot turns that
 * into "approximately this set", and the two failure directions are both bad:
 * a rank test done in floats calls a genuinely dependent key set independent
 * (because a pivot that should be 0 comes out as 1e-17), and a reconstruction
 * done in floats returns an x that is nearly right and reports it as exact.
 * Neither is visible on screen. Float elimination is one of this lab's
 * mutations for exactly that reason.
 */

import { GROUP_ORDER } from './ristretto';

/* ------------------------------------------------------------------ *
 * Exact rationals
 * ------------------------------------------------------------------ */

/** A rational number, always stored normalized with den > 0 and gcd = 1. */
export interface Frac {
  readonly num: bigint;
  readonly den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function frac(num: bigint, den: bigint = 1n): Frac {
  if (den === 0n) throw new Error('rational with zero denominator');
  let n = num;
  let d = den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return { num: 0n, den: 1n };
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

export const ZERO: Frac = { num: 0n, den: 1n };
export const ONE: Frac = { num: 1n, den: 1n };

export const fAdd = (a: Frac, b: Frac): Frac => frac(a.num * b.den + b.num * a.den, a.den * b.den);
export const fSub = (a: Frac, b: Frac): Frac => frac(a.num * b.den - b.num * a.den, a.den * b.den);
export const fMul = (a: Frac, b: Frac): Frac => frac(a.num * b.num, a.den * b.den);
export const fDiv = (a: Frac, b: Frac): Frac => {
  if (b.num === 0n) throw new Error('rational division by zero');
  return frac(a.num * b.den, a.den * b.num);
};
export const fIsZero = (a: Frac): boolean => a.num === 0n;
export const fEq = (a: Frac, b: Frac): boolean => a.num === b.num && a.den === b.den;
export const fNeg = (a: Frac): Frac => ({ num: -a.num, den: a.den });
export const fIsInteger = (a: Frac): boolean => a.den === 1n;

/** Render a rational the way a reader expects: "3", "-1", "7/2". */
export function fToString(a: Frac): string {
  return a.den === 1n ? a.num.toString() : `${a.num}/${a.den}`;
}

/* ------------------------------------------------------------------ *
 * Rational row reduction
 * ------------------------------------------------------------------ */

/**
 * The full solution set of a linear system over Q.
 *
 * `dimension` is the dimension of the affine solution set: 0 means a unique
 * point, and anything larger means the outputs have NOT pinned x down. The UI
 * is required never to draw a single x while this is positive.
 */
export type RationalSolution =
  | {
      readonly kind: 'solutions';
      /** One solution: free variables set to zero. */
      readonly particular: readonly Frac[];
      /** Basis of the null space; length equals `dimension`. */
      readonly nullSpace: readonly (readonly Frac[])[];
      readonly rank: number;
      readonly dimension: number;
      readonly pivotColumns: readonly number[];
      readonly freeColumns: readonly number[];
    }
  | {
      readonly kind: 'inconsistent';
      readonly rank: number;
    };

/**
 * Solve A z = b exactly over Q by Gauss-Jordan elimination with exact pivots.
 *
 * A is `rows x cols`; b has length `rows`. Returns the whole solution set, not
 * a single answer, because "which x are still possible" is the question this
 * lab is actually asking.
 */
export function solveRational(
  a: readonly (readonly bigint[])[],
  b: readonly bigint[],
  cols: number,
): RationalSolution {
  const rows = a.length;
  if (b.length !== rows) throw new Error(`b has length ${b.length}, expected ${rows}`);

  // Augmented matrix over Q.
  const m: Frac[][] = a.map((row, i) => {
    if (row.length !== cols) throw new Error(`row ${i} has length ${row.length}, expected ${cols}`);
    return [...row.map((v) => frac(v)), frac(b[i])];
  });

  const pivotColumns: number[] = [];
  let pivotRow = 0;
  for (let col = 0; col < cols && pivotRow < rows; col++) {
    // Find an exactly non-zero pivot. With exact rationals this test is a real
    // test; in floats it is a threshold, which is the bug.
    let sel = -1;
    for (let r = pivotRow; r < rows; r++) {
      if (!fIsZero(m[r][col])) {
        sel = r;
        break;
      }
    }
    if (sel === -1) continue;

    [m[pivotRow], m[sel]] = [m[sel], m[pivotRow]];

    const p = m[pivotRow][col];
    for (let c = col; c <= cols; c++) m[pivotRow][c] = fDiv(m[pivotRow][c], p);

    for (let r = 0; r < rows; r++) {
      if (r === pivotRow) continue;
      const factor = m[r][col];
      if (fIsZero(factor)) continue;
      for (let c = col; c <= cols; c++) {
        m[r][c] = fSub(m[r][c], fMul(factor, m[pivotRow][c]));
      }
    }
    pivotColumns.push(col);
    pivotRow++;
  }

  const rank = pivotColumns.length;

  // A zero row with a non-zero right-hand side means no solution at all. For
  // this lab that is the signature of an inconsistent claim (for instance a
  // deliberately wrong fixture), not of a rank shortfall.
  for (let r = rank; r < rows; r++) {
    if (!fIsZero(m[r][cols])) return { kind: 'inconsistent', rank };
  }

  const freeColumns: number[] = [];
  for (let c = 0; c < cols; c++) if (!pivotColumns.includes(c)) freeColumns.push(c);

  // Particular solution with every free variable at zero.
  const particular: Frac[] = new Array(cols).fill(ZERO);
  pivotColumns.forEach((col, i) => {
    particular[col] = m[i][cols];
  });

  // Null-space basis: set one free variable to 1, the rest to 0, and read the
  // pivot variables off the reduced rows.
  const nullSpace: Frac[][] = freeColumns.map((free) => {
    const v: Frac[] = new Array(cols).fill(ZERO);
    v[free] = ONE;
    pivotColumns.forEach((col, i) => {
      v[col] = fNeg(m[i][free]);
    });
    return v;
  });

  return {
    kind: 'solutions',
    particular,
    nullSpace,
    rank,
    dimension: freeColumns.length,
    pivotColumns,
    freeColumns,
  };
}

/** Rank over Q of an integer matrix. */
export function rationalRank(a: readonly (readonly bigint[])[], cols: number): number {
  if (a.length === 0) return 0;
  const sol = solveRational(a, new Array(a.length).fill(0n), cols);
  return sol.kind === 'solutions' ? sol.rank : sol.rank;
}

/* ------------------------------------------------------------------ *
 * Elimination mod l
 * ------------------------------------------------------------------ */

function mod(n: bigint): bigint {
  const r = n % GROUP_ORDER;
  return r < 0n ? r + GROUP_ORDER : r;
}

/**
 * Modular inverse mod l by the extended Euclidean algorithm.
 *
 * l is prime, so every non-zero residue is invertible — which is the whole
 * reason the master-secret recovery works with nothing but elimination.
 */
export function invMod(a: bigint): bigint {
  const v = mod(a);
  if (v === 0n) throw new Error('0 has no inverse mod l');
  let [oldR, r] = [v, GROUP_ORDER];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS);
}

export type ModularSolution =
  | { readonly kind: 'unique'; readonly solution: readonly bigint[]; readonly rank: number }
  | { readonly kind: 'underdetermined'; readonly rank: number }
  | { readonly kind: 'inconsistent'; readonly rank: number };

/**
 * Solve A z = b mod l for z in Z_l^cols.
 *
 * Only a unique solution is reported as a solution. A rank-deficient system is
 * reported as `underdetermined` WITH its rank, and the caller refuses to
 * proceed — Invariant 8. Returning a particular solution here would be
 * mathematically defensible and pedagogically false, because it would let the
 * page display a recovered master secret that is one of l^(n-rank) candidates.
 */
export function solveModular(
  a: readonly (readonly bigint[])[],
  b: readonly bigint[],
  cols: number,
): ModularSolution {
  const rows = a.length;
  if (b.length !== rows) throw new Error(`b has length ${b.length}, expected ${rows}`);
  const m: bigint[][] = a.map((row, i) => {
    if (row.length !== cols) throw new Error(`row ${i} has length ${row.length}, expected ${cols}`);
    return [...row.map(mod), mod(b[i])];
  });

  const pivotColumns: number[] = [];
  let pivotRow = 0;
  for (let col = 0; col < cols && pivotRow < rows; col++) {
    let sel = -1;
    for (let r = pivotRow; r < rows; r++) {
      if (m[r][col] !== 0n) {
        sel = r;
        break;
      }
    }
    if (sel === -1) continue;
    [m[pivotRow], m[sel]] = [m[sel], m[pivotRow]];

    const inv = invMod(m[pivotRow][col]);
    for (let c = col; c <= cols; c++) m[pivotRow][c] = mod(m[pivotRow][c] * inv);

    for (let r = 0; r < rows; r++) {
      if (r === pivotRow) continue;
      const factor = m[r][col];
      if (factor === 0n) continue;
      for (let c = col; c <= cols; c++) {
        m[r][c] = mod(m[r][c] - factor * m[pivotRow][c]);
      }
    }
    pivotColumns.push(col);
    pivotRow++;
  }

  const rank = pivotColumns.length;
  for (let r = rank; r < rows; r++) {
    if (m[r][cols] !== 0n) return { kind: 'inconsistent', rank };
  }
  if (rank < cols) return { kind: 'underdetermined', rank };

  const solution: bigint[] = new Array(cols).fill(0n);
  pivotColumns.forEach((col, i) => {
    solution[col] = m[i][cols];
  });
  return { kind: 'unique', solution, rank };
}

/** Rank mod l of an integer matrix. */
export function modularRank(a: readonly (readonly bigint[])[], cols: number): number {
  if (a.length === 0) return 0;
  const sol = solveModular(a, new Array(a.length).fill(0n), cols);
  return sol.rank;
}

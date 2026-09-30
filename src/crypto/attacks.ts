/**
 * What a collection of functional keys yields. Two results, and the difference
 * between them is the lab's strongest teaching moment.
 *
 * Neither of these is a break of ABDP15, and the code says so where the
 * sentences are written rather than leaving it to the UI. Read `whyPermitted`
 * below before writing any copy about either one.
 *
 * This module calls the outputs of `ipfe.ts`. It contains no second
 * implementation of the scheme — a parallel implementation is how an "attack"
 * ends up demonstrating a disagreement between two of your own functions.
 */

import {
  fToString,
  modularRank,
  rationalRank,
  solveModular,
  solveRational,
  type Frac,
  type RationalSolution,
} from './linalg';
import { keyDer } from './ipfe';
import type { FunctionalKey, MasterSecretKey } from './types';

/* ------------------------------------------------------------------ *
 * What the outputs say about x
 * ------------------------------------------------------------------ */

/**
 * One (y, output) pair the analyst holds: the vector a key authorized, and the
 * integer that key produced from the ciphertext.
 */
export interface Observation {
  readonly y: readonly bigint[];
  readonly output: bigint;
}

export interface KnowledgeState {
  /** Rank over Q of the y vectors collected so far. */
  readonly rank: number;
  /** Dimension of the affine set of x still consistent with every output. */
  readonly dimension: number;
  /** True only when `dimension` is 0 — one point, exactly. */
  readonly pinned: boolean;
  /** x, as exact rationals, when and only when `pinned`. */
  readonly recovered: readonly Frac[] | null;
  /** Rendered "particular + t1*v1 + ..." description of the solution set. */
  readonly description: string;
  readonly solution: RationalSolution;
  /** Set when the observations cannot all come from one x. */
  readonly inconsistent: boolean;
}

/**
 * Everything the analyst knows about x from k observations.
 *
 * Solved over Q exactly. The returned state is the whole affine family, and
 * `pinned` is false until the y vectors reach full rank — which is what lets
 * the UI honour its rule that x is never drawn before it is determined.
 *
 * Note what the rank is taken of: the y VECTORS, over Q. It is not a statement
 * about the ciphertext, and not about the group.
 */
export function knowledgeFrom(observations: readonly Observation[], n: number): KnowledgeState {
  if (observations.length === 0) {
    return {
      rank: 0,
      dimension: n,
      pinned: false,
      recovered: null,
      description: `every x in Z^${n} (no keys collected)`,
      solution: {
        kind: 'solutions',
        particular: new Array(n).fill({ num: 0n, den: 1n }),
        nullSpace: [],
        rank: 0,
        dimension: n,
        pivotColumns: [],
        freeColumns: Array.from({ length: n }, (_, i) => i),
      },
      inconsistent: false,
    };
  }

  const a = observations.map((o) => o.y);
  const b = observations.map((o) => o.output);
  const solution = solveRational(a, b, n);

  if (solution.kind === 'inconsistent') {
    return {
      rank: solution.rank,
      dimension: -1,
      pinned: false,
      recovered: null,
      description: 'no x is consistent with all of these outputs',
      solution,
      inconsistent: true,
    };
  }

  const pinned = solution.dimension === 0;
  return {
    rank: solution.rank,
    dimension: solution.dimension,
    pinned,
    recovered: pinned ? solution.particular : null,
    description: describeSolution(solution),
    solution,
    inconsistent: false,
  };
}

/** Render an affine solution set as "p + t1*v1 + t2*v2". */
export function describeSolution(solution: RationalSolution): string {
  if (solution.kind === 'inconsistent') return 'no solution';
  const vec = (v: readonly Frac[]) => `(${v.map(fToString).join(', ')})`;
  if (solution.dimension === 0) return vec(solution.particular);
  const terms = solution.nullSpace.map((v, i) => `t${i + 1}${vec(v)}`);
  return `${vec(solution.particular)} + ${terms.join(' + ')}`;
}

/**
 * Two DISTINCT vectors that are both consistent with every observation held.
 *
 * This is the evidence for "k < n keys do not determine x", and it has to be
 * DERIVED from the current observations rather than fixed in advance. A pair
 * chosen ahead of time is only consistent for the key subsets its author had
 * in mind: the previous version of this lab pinned two vectors that agree on
 * two particular keys, and 7 of the 15 non-empty subsets of the offered keys
 * then legitimately ruled the second one out — which the page misreported as
 * its own bookkeeping error rather than as the correct answer it was.
 *
 * Generated from the solution set instead: the particular solution p, and
 * p + v for the first null-space basis vector v. Every point of the affine
 * family satisfies every observation BY CONSTRUCTION, so this cannot be wrong
 * for any key subset, in any order, at any rank below n. When the family is a
 * single point there is no second candidate and this returns null — which is
 * the honest answer, not a failure.
 *
 * Neither returned vector is identified as the real plaintext, because at this
 * point nothing on the page knows which it is: that is the entire claim.
 */
export function sampleCandidates(
  state: KnowledgeState,
): { readonly first: readonly Frac[]; readonly second: readonly Frac[] } | null {
  const sol = state.solution;
  if (sol.kind !== 'solutions') return null;
  if (sol.dimension === 0 || sol.nullSpace.length === 0) return null;
  const v = sol.nullSpace[0];
  const second = sol.particular.map((p, i) => ({
    // p + v, as exact rationals.
    ...addFrac(p, v[i]),
  }));
  return { first: sol.particular, second };
}

/** Exact rational addition, kept local so this module owns its own arithmetic. */
function addFrac(a: Frac, b: Frac): Frac {
  const num = a.num * b.den + b.num * a.den;
  const den = a.den * b.den;
  const g = gcdBig(num < 0n ? -num : num, den);
  return g === 0n ? { num: 0n, den: 1n } : { num: num / g, den: den / g };
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Does a vector satisfy every observation? Computed directly from the
 * observations, with no reference to the solver — so the page's "consistent"
 * badge is a second opinion on the solver rather than an echo of it.
 */
export function isConsistent(
  candidate: readonly Frac[],
  observations: readonly Observation[],
): boolean {
  for (const o of observations) {
    // sum_i y_i * candidate_i, as an exact rational, compared against output.
    let num = 0n;
    let den = 1n;
    for (let i = 0; i < o.y.length; i++) {
      const t = { num: o.y[i] * candidate[i].num, den: candidate[i].den };
      num = num * t.den + t.num * den;
      den = den * t.den;
    }
    if (num !== o.output * den) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * What the keys alone say about s
 * ------------------------------------------------------------------ */

export type MasterRecovery =
  | {
      readonly kind: 'recovered';
      readonly s: readonly bigint[];
      readonly rank: number;
    }
  | {
      readonly kind: 'rank-deficient';
      readonly rank: number;
      readonly needed: number;
    }
  | {
      readonly kind: 'inconsistent';
      readonly rank: number;
    };

/**
 * Recover the master secret s from functional keys alone.
 *
 * NO CIPHERTEXT IS INVOLVED. The input is only the pairs (y, sk_y), and since
 * KeyDer is sk_y = <y, s> mod l, n of them with y's independent mod l are a
 * full-rank linear system over Z_l with s as its unique solution. Solving it is
 * elimination mod a prime; there is no group operation and nothing hard.
 *
 * Refuses on a rank-deficient set, reporting the rank (Invariant 8). It does
 * not return one of the many candidate solutions, because a page that printed
 * "recovered s" from a rank-2 set of 4 keys would be stating something false.
 */
export function recoverMasterSecret(
  keys: readonly FunctionalKey[],
  n: number,
): MasterRecovery {
  if (keys.length === 0) return { kind: 'rank-deficient', rank: 0, needed: n };
  const a = keys.map((k) => k.y);
  const b = keys.map((k) => k.sk);
  const sol = solveModular(a, b, n);
  if (sol.kind === 'unique') return { kind: 'recovered', s: sol.solution, rank: sol.rank };
  if (sol.kind === 'inconsistent') return { kind: 'inconsistent', rank: sol.rank };
  return { kind: 'rank-deficient', rank: sol.rank, needed: n };
}

/**
 * Rank of a set of y vectors, reported both ways.
 *
 * The two ranks can differ, and the lab shows both rather than picking one.
 * A set can be independent over Q while dependent mod l (a relation whose
 * coefficients are multiples of l) — unreachable at this lab's entry sizes, but
 * they are answers to different questions and conflating them is the sort of
 * "right conclusion, wrong chain" this lab is trying not to teach. The x
 * reconstruction is governed by the rational rank; the s recovery by the
 * modular one.
 */
export function ranks(ys: readonly (readonly bigint[])[], n: number): {
  overQ: number;
  modL: number;
} {
  return { overQ: rationalRank(ys, n), modL: modularRank(ys, n) };
}

/**
 * Proof that a recovered s IS the master secret: derive a key for a vector the
 * authority never issued.
 *
 * This is the honest test. Comparing the recovered s to the real s would only
 * show that two arrays match; deriving a working key for a FRESH y and having
 * the real ciphertext decrypt correctly under it shows that the recovered value
 * does the job of the master secret. The caller supplies the fresh y and
 * performs the decryption, so this function only builds the key.
 */
export function forgeKey(recovered: readonly bigint[], y: readonly bigint[]): FunctionalKey {
  const asMsk: MasterSecretKey = { s: recovered, n: recovered.length };
  // Deliberately the real KeyDer, not a copy of it: the forged key has to be
  // the same kind of object the authority would have made.
  return keyDer(asMsk, y);
}

/**
 * Why neither result breaks ABDP15 — the exact statement, scoped to the
 * mechanism, for the UI to use verbatim.
 *
 * Checked against ABDP15's Theorem 3.2 proof sketch, which says the adversary
 * "is allowed to ask only secret keys for vectors in the vector sub-space
 * generated by the z_i's, and thus orthogonal to x1 - x0", i.e. keys are
 * constrained to y with <x0, y> = <x1, y>.
 *
 * The chain, written out because the tempting short version is false:
 *
 *   - The security game does not promise that keys reveal nothing beyond one
 *     inner product. It promises that an adversary cannot distinguish x0 from
 *     x1 using keys that give the SAME answer on both.
 *   - If y_1..y_n are independent and <x0, y_i> = <x1, y_i> for all i, then
 *     x1 - x0 is orthogonal to a basis, so x1 - x0 = 0 and x0 = x1. There is
 *     no pair of distinct messages left for the adversary to tell apart, so the
 *     game is vacuous at that point rather than lost.
 *   - Therefore recovering x from n independent outputs is the functionality
 *     doing what it was asked, and recovering s from n independent keys is the
 *     same fact with the ciphertext removed.
 *
 * The limit is in what was authorized, not in the proof. What it is NOT: this
 * says nothing about whether ABDP15 is adaptively secure. Its own constructions
 * are proved only against SELECTIVE adversaries — ALS16's abstract states that
 * outright — and adaptive security for this functionality arrived in 2016 from
 * two directions: ALS16 (new constructions from hash proof systems, same
 * assumptions, plus a DCR solution) and ABCP16, the ABDP15 authors' own
 * follow-up (ePrint 2016/011), a generic construction instantiated from
 * ElGamal/DDH, Paillier-BCP/DCR and Regev/LWE. Neither re-proves THIS
 * construction; both replace it. So the scope is exact both ways: this scheme
 * is not proven adaptively secure, and adaptively secure IPFE under the same
 * assumptions is not an open problem.
 *
 * Nor is any of it an argument that collusion is harmless in a deployment — an
 * authority that issues n independent keys has given away the master secret,
 * which is a key-management fact the proof cannot help with.
 */
export const WHY_PERMITTED = {
  headline: 'Authorized, not broken',
  short:
    'n independent keys are the master secret. ABDP15 still holds: its game only ' +
    'constrains keys that answer the same on both challenge messages, and n ' +
    'independent such keys force the two messages to be equal.',
  chain: [
    'The proof constrains key queries to vectors y with <x0, y> = <x1, y>.',
    'n independent such y force x1 - x0 = 0, so there are no two distinct messages left to distinguish.',
    'So full reconstruction is the functionality delivering what was authorized, not a failure of the proof.',
  ],
  notClaimed:
    'This is not an argument that ABDP15 is adaptively secure: its own constructions are ' +
    'proved only against selective adversaries, and adaptive security for this functionality ' +
    'comes from later work (ALS16, ABCP16) that replaces the construction rather than ' +
    're-proving it. Nor is it an argument that collusion is harmless in deployment: an ' +
    'authority that issues n independent keys has given away s.',
} as const;

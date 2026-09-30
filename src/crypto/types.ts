/**
 * Shared types for the IPFE lab.
 *
 * A NOTATION WARNING, because two conventions collide here and mixing them
 * silently is exactly the kind of error this lab is about.
 *
 *   ABDP15 writes the vector dimension as l and the group order as p.
 *   RFC 9496 writes the ristretto255 group order as l.
 *
 * This lab follows RFC 9496 for the group and renames the dimension:
 *
 *   n  = vector dimension          (ABDP15's l)
 *   l  = group order, GROUP_ORDER  (ABDP15's p)
 *
 * So a reader holding the paper open should read our `n` where it says `l`.
 *
 * The second half of the same discipline: entries of x and y are INTEGERS, and
 * keys are SCALARS mod l. They are different types of thing and the lab never
 * mixes them implicitly — every conversion goes through `toScalar` in
 * `ristretto.ts` and is visible at the call site.
 */

import type { GroupElement } from './ristretto';

/** Hard cap on the vector dimension, for in-browser tractability. */
export const MAX_N = 8;

/**
 * Entries of x and y are drawn from this small signed range. With n = 8 the
 * largest inner product reachable is 8 * 9 * 9 = 648, which is why the default
 * bound B sits comfortably above it.
 */
export const ENTRY_MIN = -9;
export const ENTRY_MAX = 9;

/**
 * Master public key. ABDP15 Construction 3.1 sets mpk = (h_i = g^{s_i}) and
 * leaves g in the re-usable public parameters returned by GroupGen; we carry g
 * alongside for convenience. That is a packaging choice, not a deviation from
 * the paper, and the paper does not write it this way.
 */
export interface MasterPublicKey {
  readonly g: GroupElement;
  readonly h: readonly GroupElement[];
  readonly n: number;
}

/** Master secret key: s in Z_l^n. ABDP15 msk = s. */
export interface MasterSecretKey {
  readonly s: readonly bigint[];
  readonly n: number;
}

export interface KeyPair {
  readonly mpk: MasterPublicKey;
  readonly msk: MasterSecretKey;
}

/** Ciphertext: ct_0 = g^r and ct_i = h_i^r * g^{x_i}. */
export interface Ciphertext {
  readonly ct0: GroupElement;
  readonly ct: readonly GroupElement[];
  readonly n: number;
}

/**
 * A functional key: the vector y it authorizes, and sk_y = <s, y> mod l.
 *
 * `y` is kept as integers because the analyst's linear algebra is over the
 * integers/rationals, while `sk` is a scalar mod l. Holding both in one record
 * is deliberate: it is the object that makes the lab's point, since n of these
 * determine s with no ciphertext in sight.
 */
export interface FunctionalKey {
  readonly y: readonly bigint[];
  readonly sk: bigint;
}

/** Group operations charged to a discrete-log search, by phase. */
export interface DlogOps {
  /** Scalar multiplications and negations done once before the search. */
  readonly setup: number;
  /** Additions building the baby-step table. */
  readonly babySteps: number;
  /** Additions walking the giant steps. */
  readonly giantSteps: number;
  readonly total: number;
}

/**
 * The result of a bounded discrete-log search.
 *
 * A discriminated union rather than a nullable number, so that "not found in
 * range" cannot be read as a value by accident. Invariant 3 is that an
 * out-of-range inner product is a FAILURE, never a wrapped answer.
 */
export type DlogResult =
  | {
      readonly found: true;
      readonly value: bigint;
      readonly ops: DlogOps;
      readonly tableSize: number;
      readonly width: bigint;
    }
  | {
      readonly found: false;
      readonly reason: 'not-found-in-range';
      readonly ops: DlogOps;
      readonly tableSize: number;
      readonly width: bigint;
    };

/**
 * What Decrypt produces. `element` is g^<x,y> — an opaque group element that
 * exists whether or not the search succeeds. The UI shows it FIRST, then the
 * integer, because the visible gap between the two is the lesson.
 */
export interface DecryptResult {
  readonly element: GroupElement;
  readonly dlog: DlogResult;
}

/**
 * ABDP15 Construction 3.1 — the DDH-based inner-product FE scheme. Scheme only.
 *
 * Source, read directly rather than from memory:
 *   M. Abdalla, F. Bourse, A. De Caro, D. Pointcheval, "Simple Functional
 *   Encryption Schemes for Inner Products", PKC 2015; ePrint 2015/017,
 *   Section 3 "Inner-Product from DDH", Construction 3.1 (version dated
 *   October 1, 2015; SHA-256 of the fetched PDF
 *   353f454857a5ef421ab7b17545b9657f5d192dc0a37f022cca7b71e916f84712).
 *
 * The paper's four algorithms, verbatim in structure:
 *
 *   Setup(1^k, 1^n)  s <- Z_l^n ;  mpk = (h_i = g^{s_i})_{i in [n]} ;  msk = s
 *   Encrypt(mpk, x)  r <- Z_l ;  ct_0 = g^r ;  ct_i = h_i^r * g^{x_i}
 *   KeyDer(msk, y)   sk_y = <y, s>
 *   Decrypt(...)     dlog_g ( prod_i ct_i^{y_i} / ct_0^{sk_y} )
 *
 * One packaging difference, stated rather than implied: the paper's mpk is
 * (h_i) alone, with g arriving in the public parameters from GroupGen. We carry
 * g inside `MasterPublicKey`. Nothing else here departs from Construction 3.1.
 *
 * The correctness identity, also from the paper:
 *
 *   prod_i ct_i^{y_i} / ct_0^{sk_y}
 *     = g^{r * sum_i y_i s_i + sum_i y_i x_i - r * sum_i y_i s_i}
 *     = g^{<x, y>}
 *
 * so the r terms cancel and what survives is exactly the inner product. That
 * cancellation is why ct_0 has to be there, and dropping it is one of this
 * lab's mutations.
 *
 * Security, from Theorem 3.2: the scheme is s-IND-FE-CPA under DDH —
 * SELECTIVE indistinguishability, and CPA only. Adaptive security needs ALS16.
 * No CCA claim is made anywhere, and the ciphertext is additively malleable by
 * construction (see `combineCiphertexts`).
 */

import {
  GENERATOR,
  GROUP_ORDER,
  IDENTITY,
  add,
  scalarMul,
  scalarMulBase,
  subtract,
  toScalar,
  type GroupElement,
} from './ristretto';
import { dlogSymmetric } from './dlog';
import type {
  Ciphertext,
  DecryptResult,
  FunctionalKey,
  KeyPair,
  MasterPublicKey,
  MasterSecretKey,
} from './types';
import { MAX_N } from './types';

/** Source of scalars. The lab uses a seeded one for fixtures and a real one live. */
export interface ScalarSource {
  /** A uniform scalar in [0, l). */
  nextScalar(): bigint;
}

function checkDimension(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new Error(`dimension must be a positive integer, got ${n}`);
  if (n > MAX_N) throw new Error(`dimension ${n} exceeds the in-browser cap ${MAX_N}`);
}

/**
 * Setup(1^k, 1^n): sample s <- Z_l^n and publish h_i = g^{s_i}.
 */
export function setup(n: number, rng: ScalarSource): KeyPair {
  checkDimension(n);
  const s: bigint[] = [];
  const h: GroupElement[] = [];
  for (let i = 0; i < n; i++) {
    const si = toScalar(rng.nextScalar());
    s.push(si);
    h.push(scalarMulBase(si));
  }
  return {
    mpk: { g: GENERATOR, h, n },
    msk: { s, n },
  };
}

/**
 * KeyDer(msk, y): sk_y = <y, s> mod l.
 *
 * The reduction mod l is not cosmetic. y has signed integer entries, so the
 * raw inner product is a signed integer that may exceed l or be negative;
 * `toScalar` is what turns it into the scalar the group will accept. Skipping
 * the reduction is one of this lab's mutations.
 */
export function keyDer(msk: MasterSecretKey, y: readonly bigint[]): FunctionalKey {
  if (y.length !== msk.n) {
    throw new Error(`y has length ${y.length}, expected ${msk.n}`);
  }
  let acc = 0n;
  for (let i = 0; i < msk.n; i++) {
    acc += y[i] * msk.s[i];
  }
  return { y: [...y], sk: toScalar(acc) };
}

/**
 * Encrypt(mpk, x): r <- Z_l, ct_0 = g^r, ct_i = h_i^r * g^{x_i}.
 *
 * Fresh r per call, which is why two encryptions of the same x agree in no
 * component (Invariant 2).
 */
export function encrypt(
  mpk: MasterPublicKey,
  x: readonly bigint[],
  rng: ScalarSource,
): Ciphertext {
  if (x.length !== mpk.n) {
    throw new Error(`x has length ${x.length}, expected ${mpk.n}`);
  }
  const r = toScalar(rng.nextScalar());
  const ct0 = scalarMulBase(r);
  const ct: GroupElement[] = [];
  for (let i = 0; i < mpk.n; i++) {
    // h_i^r * g^{x_i}. x_i is a signed integer; scalarMul carries it into the
    // scalar field explicitly, which is what makes negative entries work.
    ct.push(add(scalarMul(mpk.h[i], r), scalarMulBase(x[i])));
  }
  return { ct0, ct, n: mpk.n };
}

/**
 * The group element g^{<x,y>}, before any discrete log.
 *
 * Split out from `decrypt` because the UI shows this first, on its own, as an
 * opaque encoding — the point being that decryption has already succeeded here
 * and the integer is still not in hand.
 */
export function decryptToElement(
  ciphertext: Ciphertext,
  key: FunctionalKey,
): GroupElement {
  if (key.y.length !== ciphertext.n) {
    throw new Error(`y has length ${key.y.length}, expected ${ciphertext.n}`);
  }
  let numerator: GroupElement = IDENTITY;
  for (let i = 0; i < ciphertext.n; i++) {
    numerator = add(numerator, scalarMul(ciphertext.ct[i], key.y[i]));
  }
  // Dividing by ct_0^{sk_y} is what cancels the r terms. Without it the result
  // carries g^{r<s,y>} and the dlog search finds nothing.
  return subtract(numerator, scalarMul(ciphertext.ct0, key.sk));
}

/**
 * Decrypt(mpk, Ct, sk_y): the paper's algorithm, in two visible halves.
 *
 * Returns the group element AND the bounded search over it. A failed search is
 * reported as a failure; there is no path here that returns a wrong integer.
 */
export function decrypt(
  ciphertext: Ciphertext,
  key: FunctionalKey,
  bound: bigint,
): DecryptResult {
  const element = decryptToElement(ciphertext, key);
  return { element, dlog: dlogSymmetric(element, bound) };
}

/**
 * Componentwise product of two ciphertexts.
 *
 * ct(x) . ct(x') = (g^{r+r'}, (h_i^{r+r'} g^{x_i + x'_i})), which is a
 * well-formed encryption of x + x' under randomness r + r'. So it decrypts to
 * <x + x', y> under any functional key.
 *
 * This is not an attack and not a flaw in the proof: ABDP15 claims CPA
 * security, and CPA says nothing about an adversary's ability to maul a
 * ciphertext into another valid one. It is the exhibit for the lab's negative
 * claim, and the reason no CCA claim appears anywhere in this repo.
 */
export function combineCiphertexts(a: Ciphertext, b: Ciphertext): Ciphertext {
  if (a.n !== b.n) throw new Error(`dimension mismatch: ${a.n} vs ${b.n}`);
  return {
    ct0: add(a.ct0, b.ct0),
    ct: a.ct.map((c, i) => add(c, b.ct[i])),
    n: a.n,
  };
}

/**
 * The plain integer inner product, over Z, with no group and no reduction.
 *
 * Used by the UI to display the value Decrypt is supposed to find. Tests do NOT
 * import this — they recompute the dot product themselves, because a test that
 * calls the same helper the source calls will agree with a bug in it.
 */
export function innerProduct(x: readonly bigint[], y: readonly bigint[]): bigint {
  if (x.length !== y.length) throw new Error(`length mismatch: ${x.length} vs ${y.length}`);
  let acc = 0n;
  for (let i = 0; i < x.length; i++) acc += x[i] * y[i];
  return acc;
}

/** Re-exported so callers need not reach past this module for the modulus. */
export { GROUP_ORDER };

// [extension] point: ALS16's adaptive-secure variant keeps this same interface
// -- Setup/KeyDer/Encrypt/Decrypt over a prime-order group -- and changes what
// mpk carries and how the proof goes. A function-hiding variant would instead
// need `FunctionalKey` to stop carrying y in the clear, which is the one place
// this file would have to change shape rather than contents.

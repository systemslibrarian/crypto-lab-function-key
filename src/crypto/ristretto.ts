/**
 * The ONE chokepoint in front of @noble/curves.
 *
 * Every group operation in this lab goes through this module. Nothing else
 * imports '@noble/curves/ed25519.js'. That is a deliberate structural rule, not
 * tidiness: the library has a real precondition on scalar multiplication, and a
 * precondition enforced in one place is a precondition, while a precondition
 * left as a comment is a latent bug.
 *
 * THE PRECONDITION, measured on @noble/curves 2.4.0:
 *
 *   Point.BASE.multiply(0n)   throws  'invalid scalar: expected 1 <= sc < curve.n'
 *   Point.BASE.multiply(-3n)  throws  'invalid scalar: expected 1 <= sc < curve.n'
 *   Point.BASE.multiply(L+1n) throws  (same)
 *
 * Those three inputs are not exotic here. This lab is inner-product functional
 * encryption over SIGNED vectors, so:
 *
 *   - y = 0 is an explicit edge case (sk_y = 0, output 0), and it hands the
 *     group a zero scalar;
 *   - entries of x and y are drawn from a small signed range, so negative
 *     scalars occur on the ordinary path, not just at the edges;
 *   - <s, y> is reduced mod L and so can legitimately land on 0.
 *
 * The mathematically correct answers are: the identity for 0, and the inverse
 * of the positive multiple for a negative scalar. `scalarMul` returns those.
 * `ristretto.test.ts` asserts BOTH halves of that — the raw call throwing and
 * the chokepoint returning the right element, cross-checked by an independent
 * route — so the difference is a test result rather than a claim in a comment.
 *
 * Trust anchor: RFC 9496 Appendix A, pinned in `rfc9496-vectors.ts` and checked
 * in `ristretto.test.ts`. Read that test before trusting anything downstream.
 */

import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';

/**
 * @noble/curves v2 renamed the v1 `RistrettoPoint` export to
 * `ristretto255.Point`. Confirmed present in the installed 2.4.0 build by
 * `ristretto.test.ts`, which fails loudly rather than silently degrading if a
 * future version moves it again.
 */
const Point = ristretto255.Point;

export type GroupElement = InstanceType<typeof Point>;

/** The prime order of the ristretto255 group, written l in RFC 9496. */
export const GROUP_ORDER: bigint = Point.Fn.ORDER;

/** The canonical generator, B in RFC 9496 Appendix A.1. Written g in ABDP15. */
export const GENERATOR: GroupElement = Point.BASE;

/** The group identity. */
export const IDENTITY: GroupElement = Point.ZERO;

/**
 * Reduce an arbitrary integer into the scalar field [0, l).
 *
 * This is the only sanctioned integer -> scalar conversion in the lab. It is
 * exported so that call sites have to name the conversion rather than letting a
 * signed integer drift into a place that wants a scalar: the brief requires
 * that integers (entries of x and y, inner products over Z) and scalars (mod l)
 * are never mixed silently.
 *
 * JavaScript's `%` is truncating, so `-3n % l` is `-3n`, not `l - 3n`. The
 * addition and second reduction are what make this a mathematical mod.
 */
export function toScalar(n: bigint): bigint {
  const r = n % GROUP_ORDER;
  return r < 0n ? r + GROUP_ORDER : r;
}

/**
 * Scalar multiplication, total over the integers.
 *
 * Accepts any bigint — zero, negative, or larger than l — and returns the
 * correct group element, which is what the raw library call will not do. See
 * the precondition note at the top of this file.
 */
export function scalarMul(point: GroupElement, scalar: bigint): GroupElement {
  const k = toScalar(scalar);
  if (k === 0n) return IDENTITY;
  return point.multiply(k);
}

/** g^k for the canonical generator g. Total over the integers, as `scalarMul`. */
export function scalarMulBase(scalar: bigint): GroupElement {
  return scalarMul(GENERATOR, scalar);
}

export function add(a: GroupElement, b: GroupElement): GroupElement {
  return a.add(b);
}

export function subtract(a: GroupElement, b: GroupElement): GroupElement {
  return a.subtract(b);
}

export function negate(a: GroupElement): GroupElement {
  return a.negate();
}

export function equals(a: GroupElement, b: GroupElement): boolean {
  return a.equals(b);
}

/** Canonical 32-byte encoding (RFC 9496 Section 4.3.2). */
export function toBytes(point: GroupElement): Uint8Array {
  return point.toBytes();
}

/** Lowercase hex of the canonical encoding. */
export function toHex(point: GroupElement): string {
  return point.toHex();
}

/**
 * Canonical decoding (RFC 9496 Section 4.3.1). Throws on every encoding the RFC
 * requires to be rejected; `ristretto.test.ts` drives all 29 Appendix A.2
 * vectors through it. Strict parsing is an invariant, so this never falls back
 * to a "best effort" point.
 */
export function fromHex(hex: string): GroupElement {
  return Point.fromHex(hex);
}

/**
 * The RFC 9496 Section 4.3.4 one-way map from 64 uniform bytes.
 *
 * `deriveToCurve` is v2's name for this. It is NOT `hashToCurve`, which in v2 is
 * the RFC 9380 hash-to-curve and returns different elements for the same input
 * — a substitution that would be invisible except against the A.3 vectors, so
 * the A.3 vectors are what pin it.
 *
 * Resolved once, here, because `deriveToCurve` is optional on the shared hasher
 * interface: a future build that drops it must fail loudly rather than silently
 * routing to a different map.
 */
function requireDeriveToCurve(): (bytes: Uint8Array) => GroupElement {
  const fn = ristretto255_hasher.deriveToCurve;
  if (!fn) {
    throw new Error(
      'ristretto255_hasher.deriveToCurve is unavailable in this @noble/curves ' +
        'build; the RFC 9496 Section 4.3.4 one-way map is required.',
    );
  }
  return fn.bind(ristretto255_hasher) as (bytes: Uint8Array) => GroupElement;
}

const deriveToCurve = requireDeriveToCurve();

/** Map 64 uniform bytes to a group element per RFC 9496 Section 4.3.4. */
export function fromUniformBytes(bytes: Uint8Array): GroupElement {
  if (bytes.length !== 64) {
    throw new Error(`element derivation needs exactly 64 bytes, got ${bytes.length}`);
  }
  return deriveToCurve(bytes);
}

/**
 * Escape hatch for the one test that must prove the precondition is real: it
 * needs the unnormalised library call to compare against. Nothing in `src/`
 * outside `ristretto.test.ts` may use this — going through it is the whole
 * point of the module.
 *
 * @internal
 */
export const RAW_LIBRARY_POINT_FOR_TESTS = Point;

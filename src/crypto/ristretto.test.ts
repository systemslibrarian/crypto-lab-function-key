/**
 * GATE 1 — the group library's trust anchor.
 *
 * This suite exists because of a rule that cost a sibling lab real time: a
 * wrapper that is subtly wrong looks exactly like a lab that is subtly wrong,
 * and you will look for the bug in your own code. So @noble/curves is checked
 * against a PUBLISHED vector (RFC 9496 Appendix A, from the RFC Editor) before
 * any scheme code is written on top of it, and the check is pinned here so it
 * keeps holding across dependency bumps.
 *
 * Nothing in this file re-derives a ristretto255 answer by a second route and
 * compares the library to itself — that would agree with a broken library. Every
 * expectation is a constant published by the CFRG.
 */

import { describe, it, expect } from 'vitest';
import {
  A1_GENERATOR_MULTIPLES,
  A2_INVALID_ENCODINGS,
  A3_UNIFORM_BYTES,
} from './rfc9496-vectors';
import {
  GENERATOR,
  GROUP_ORDER,
  IDENTITY,
  RAW_LIBRARY_POINT_FOR_TESTS,
  add,
  equals,
  fromHex,
  fromUniformBytes,
  negate,
  scalarMul,
  scalarMulBase,
  toHex,
  toScalar,
} from './ristretto';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe('RFC 9496 A.1 — multiples of the generator', () => {
  it('pins 16 vectors (a shrunken list would weaken the gate silently)', () => {
    expect(A1_GENERATOR_MULTIPLES).toHaveLength(16);
  });

  // Encoding path: g^i computed by scalar multiplication must encode to B[i].
  it.each(A1_GENERATOR_MULTIPLES.map((hex, i) => ({ i, hex })))(
    'scalarMulBase($i) encodes to B[$i]',
    ({ i, hex }) => {
      expect(toHex(scalarMulBase(BigInt(i)))).toBe(hex);
    },
  );

  // Decoding path: B[i] must decode to the same element, so fromHex and toHex
  // are checked against the RFC rather than against each other.
  it.each(A1_GENERATOR_MULTIPLES.map((hex, i) => ({ i, hex })))(
    'B[$i] decodes to the element whose encoding it is',
    ({ i, hex }) => {
      expect(equals(fromHex(hex), scalarMulBase(BigInt(i)))).toBe(true);
    },
  );

  // The RFC points this out explicitly: because B[i+1] = B[i] + B[1], the A.1
  // list tests the encoding function and the addition law at the same time.
  it('B[i+1] = B[i] + B[1] across the whole list, exercising addition', () => {
    for (let i = 0; i < A1_GENERATOR_MULTIPLES.length - 1; i++) {
      const next = add(fromHex(A1_GENERATOR_MULTIPLES[i]), fromHex(A1_GENERATOR_MULTIPLES[1]));
      expect(toHex(next)).toBe(A1_GENERATOR_MULTIPLES[i + 1]);
    }
  });

  it('B[0] is the identity encoding (all zero bytes)', () => {
    expect(A1_GENERATOR_MULTIPLES[0]).toBe('0'.repeat(64));
    expect(toHex(IDENTITY)).toBe(A1_GENERATOR_MULTIPLES[0]);
  });
});

describe('RFC 9496 A.2 — encodings that MUST be rejected', () => {
  it('pins 29 vectors', () => {
    expect(A2_INVALID_ENCODINGS).toHaveLength(29);
  });

  it.each(A2_INVALID_ENCODINGS)('rejects $hex ($reason)', ({ hex }) => {
    expect(() => fromHex(hex)).toThrow();
  });

  // A rejecter that rejects everything would pass the block above while being
  // useless. This is the positive control for it.
  it('the same decoder accepts every valid A.1 encoding', () => {
    for (const hex of A1_GENERATOR_MULTIPLES) {
      expect(() => fromHex(hex)).not.toThrow();
    }
  });
});

describe('RFC 9496 A.3 — the Section 4.3.4 one-way map', () => {
  it('pins 8 input/output pairs', () => {
    expect(A3_UNIFORM_BYTES).toHaveLength(8);
  });

  // This is what distinguishes deriveToCurve (RFC 9496 4.3.4) from v2's
  // hashToCurve (RFC 9380). Substituting one for the other is invisible without
  // these vectors and would change every derived element.
  it.each(A3_UNIFORM_BYTES)('maps $input to $output', ({ input, output }) => {
    expect(toHex(fromUniformBytes(hexToBytes(input)))).toBe(output);
  });

  it('refuses an input that is not exactly 64 bytes', () => {
    expect(() => fromUniformBytes(new Uint8Array(63))).toThrow(/64 bytes/);
    expect(() => fromUniformBytes(new Uint8Array(65))).toThrow(/64 bytes/);
  });
});

/**
 * BUILD DISCIPLINE item 2 — the wrapped primitive's precondition, as a test
 * rather than a comment.
 *
 * Each case shows the RAW library call and the chokepoint call disagreeing on an
 * input this lab actually produces, and pins the chokepoint's answer to an
 * independent route (negation, or the published identity encoding) rather than
 * to the library's own scalar multiplication.
 */
describe('the chokepoint earns its place: raw library vs scalarMul', () => {
  const Raw = RAW_LIBRARY_POINT_FOR_TESTS;

  it('zero scalar: the raw call throws where the identity is correct', () => {
    // The raw precondition. If a future bump makes this stop throwing, this
    // assertion fails and the comment above stops being a stale claim.
    expect(() => Raw.BASE.multiply(0n)).toThrow(/invalid scalar/);

    // The chokepoint's answer, pinned to the RFC's own identity encoding.
    expect(toHex(scalarMulBase(0n))).toBe(A1_GENERATOR_MULTIPLES[0]);
    expect(equals(scalarMulBase(0n), IDENTITY)).toBe(true);
  });

  it('negative scalar: the raw call throws where the inverse is correct', () => {
    expect(() => Raw.BASE.multiply(-3n)).toThrow(/invalid scalar/);

    // g^-3 == -(g^3). The right-hand side reaches the answer by negation, so
    // this does not just recompute the same scalar multiplication.
    expect(equals(scalarMulBase(-3n), negate(fromHex(A1_GENERATOR_MULTIPLES[3])))).toBe(true);
  });

  it('scalar at or above the group order: the raw call throws where wrapping is correct', () => {
    expect(() => Raw.BASE.multiply(GROUP_ORDER)).toThrow(/invalid scalar/);
    expect(() => Raw.BASE.multiply(GROUP_ORDER + 1n)).toThrow(/invalid scalar/);

    // g^l is the identity and g^(l+1) is g, both pinned to A.1 encodings.
    expect(toHex(scalarMulBase(GROUP_ORDER))).toBe(A1_GENERATOR_MULTIPLES[0]);
    expect(toHex(scalarMulBase(GROUP_ORDER + 1n))).toBe(A1_GENERATOR_MULTIPLES[1]);
  });

  it('toScalar is a mathematical mod, not JavaScript % (which is truncating)', () => {
    // The trap this guards: -3n % l is -3n in JavaScript, and feeding that back
    // to the group throws or, in a library that did not check, would be wrong.
    expect(-3n % GROUP_ORDER).toBe(-3n);
    expect(toScalar(-3n)).toBe(GROUP_ORDER - 3n);
    expect(toScalar(GROUP_ORDER)).toBe(0n);
    expect(toScalar(GROUP_ORDER + 5n)).toBe(5n);
    expect(toScalar(7n)).toBe(7n);
  });

  it('a non-base point takes the same total treatment', () => {
    const p = scalarMulBase(5n);
    expect(() => Raw.BASE.multiply(5n).multiply(0n)).toThrow(/invalid scalar/);
    expect(equals(scalarMul(p, 0n), IDENTITY)).toBe(true);
    expect(equals(scalarMul(p, -1n), negate(p))).toBe(true);
    // (g^5)^3 == g^15, pinned to A.1's last entry.
    expect(toHex(scalarMul(p, 3n))).toBe(A1_GENERATOR_MULTIPLES[15]);
  });
});

describe('group order', () => {
  it('is the prime l from RFC 9496 (2^252 + 27742317777372353535851937790883648493)', () => {
    expect(GROUP_ORDER).toBe(2n ** 252n + 27742317777372353535851937790883648493n);
  });

  it('the generator is not the identity', () => {
    expect(equals(GENERATOR, IDENTITY)).toBe(false);
  });
});

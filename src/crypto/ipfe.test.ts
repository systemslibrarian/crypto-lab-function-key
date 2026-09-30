/**
 * ABDP15 Construction 3.1 — correctness, randomization, and the boundaries.
 *
 * The rule this file follows: where a value has to be checked, it is recomputed
 * HERE by a different route than `ipfe.ts` takes. In particular the inner
 * product is computed by a plain loop in this file and `innerProduct` from the
 * lab is never imported — a test that calls the same helper the source calls
 * will agree with a bug in that helper.
 */

import { describe, it, expect } from 'vitest';
import { setup, keyDer, encrypt, decrypt, decryptToElement, combineCiphertexts } from './ipfe';
import { seededSource } from './prng';
import {
  GROUP_ORDER,
  equals,
  scalarMulBase,
  toHex,
  toScalar,
} from './ristretto';
import { dlogSymmetric } from './dlog';
import {
  CORRECTNESS_FIXTURES,
  DEFAULT_BOUND,
  PARTIAL_KNOWLEDGE,
  WRONG_ON_PURPOSE,
} from './fixtures';
import { MAX_N } from './types';

/**
 * The independent dot product. Deliberately a bare loop in the test file, so it
 * shares no code with the lab.
 */
function dotProduct(x: readonly bigint[], y: readonly bigint[]): bigint {
  let acc = 0n;
  for (let i = 0; i < x.length; i++) acc += x[i] * y[i];
  return acc;
}

describe('dotProduct (the test file\'s own checker)', () => {
  // A checker has to be checked too, or the cross-check is circular.
  it('agrees with hand-computed values', () => {
    expect(dotProduct([3n, 1n, 4n, 1n], [2n, 0n, 1n, 5n])).toBe(15n);
    expect(dotProduct([-3n, 5n], [4n, -2n])).toBe(-22n);
    expect(dotProduct([5n], [0n])).toBe(0n);
    expect(dotProduct([], [])).toBe(0n);
  });
});

describe('Invariant 1 — Decrypt returns exactly <x, y> over the integers', () => {
  const real = CORRECTNESS_FIXTURES.filter((f) => !f.wrongOnPurpose);

  it('exercises 6 honest fixtures plus 1 deliberately wrong one', () => {
    expect(real).toHaveLength(6);
    expect(CORRECTNESS_FIXTURES.filter((f) => f.wrongOnPurpose)).toHaveLength(1);
  });

  it.each(real)('$label: decrypts to the integer dot product', (f) => {
    const rng = seededSource(f.seed);
    const { mpk, msk } = setup(f.n, rng);
    const key = keyDer(msk, f.y);
    const ct = encrypt(mpk, f.x, rng);
    const bound = 2048n;
    const result = decrypt(ct, key, bound);

    const expected = dotProduct(f.x, f.y);
    expect(result.dlog.found).toBe(true);
    if (!result.dlog.found) return;
    expect(result.dlog.value).toBe(expected);
    // And the fixture's own claim agrees with the independent computation, so a
    // wrong fixture cannot hide behind a wrong implementation.
    expect(f.claimed).toBe(expected);
  });

  it('the deliberately wrong fixture claims a value the scheme does not produce', () => {
    const f = CORRECTNESS_FIXTURES.find((x) => x.id === WRONG_ON_PURPOSE);
    expect(f).toBeDefined();
    if (!f) return;
    const rng = seededSource(f.seed);
    const { mpk, msk } = setup(f.n, rng);
    const ct = encrypt(mpk, f.x, rng);
    const result = decrypt(ct, keyDer(msk, f.y), 2048n);
    expect(result.dlog.found).toBe(true);
    if (!result.dlog.found) return;
    // The scheme is right; the CLAIM is wrong. That is the point of the row.
    expect(result.dlog.value).toBe(dotProduct(f.x, f.y));
    expect(result.dlog.value).not.toBe(f.claimed);
  });

  it('holds across every dimension up to the cap', () => {
    for (let n = 1; n <= MAX_N; n++) {
      const rng = seededSource(`dims/${n}`);
      const { mpk, msk } = setup(n, rng);
      const x = Array.from({ length: n }, (_, i) => BigInt(((i * 7) % 19) - 9));
      const y = Array.from({ length: n }, (_, i) => BigInt(((i * 5) % 19) - 9));
      const result = decrypt(encrypt(mpk, x, rng), keyDer(msk, y), 2048n);
      expect(result.dlog.found).toBe(true);
      if (result.dlog.found) expect(result.dlog.value).toBe(dotProduct(x, y));
    }
  });

  it('the intermediate element really is g^<x,y>, checked against g^m directly', () => {
    const rng = seededSource('element-check');
    const { mpk, msk } = setup(4, rng);
    const x = [3n, -2n, 5n, 1n];
    const y = [2n, 4n, -1n, 3n];
    const element = decryptToElement(encrypt(mpk, x, rng), keyDer(msk, y));
    // Independent route: raise the generator to the dot product this file
    // computed. No dlog search involved.
    expect(equals(element, scalarMulBase(dotProduct(x, y)))).toBe(true);
  });
});

describe('Invariant 2 — encryption is randomized', () => {
  it('two encryptions of the same x differ in every component', () => {
    const rng = seededSource('randomized');
    const { mpk } = setup(4, rng);
    const x = [1n, 2n, 3n, 4n];
    const a = encrypt(mpk, x, rng);
    const b = encrypt(mpk, x, rng);
    expect(toHex(a.ct0)).not.toBe(toHex(b.ct0));
    for (let i = 0; i < 4; i++) {
      expect(toHex(a.ct[i])).not.toBe(toHex(b.ct[i]));
    }
  });

  it('but both decrypt to the same answer under the same key', () => {
    const rng = seededSource('randomized-same-answer');
    const { mpk, msk } = setup(4, rng);
    const x = [1n, 2n, 3n, 4n];
    const y = [5n, -1n, 0n, 2n];
    const key = keyDer(msk, y);
    const a = decrypt(encrypt(mpk, x, rng), key, 512n);
    const b = decrypt(encrypt(mpk, x, rng), key, 512n);
    expect(a.dlog.found && b.dlog.found).toBe(true);
    if (a.dlog.found && b.dlog.found) {
      expect(a.dlog.value).toBe(dotProduct(x, y));
      expect(b.dlog.value).toBe(a.dlog.value);
    }
  });
});

describe('Invariant 3 — out of range is failure, never a wrapped answer', () => {
  it('reports not-found rather than any integer when |<x,y>| exceeds B', () => {
    const rng = seededSource('out-of-range');
    const { mpk, msk } = setup(4, rng);
    const x = [9n, 9n, 9n, 9n];
    const y = [9n, 9n, 9n, 9n];
    const trueValue = dotProduct(x, y);
    expect(trueValue).toBe(324n);

    const result = decrypt(encrypt(mpk, x, rng), keyDer(msk, y), 10n);
    expect(result.dlog.found).toBe(false);
    if (result.dlog.found) return;
    expect(result.dlog.reason).toBe('not-found-in-range');
  });

  it('finds the value exactly at +B and fails at B+1 (both directions)', () => {
    const rng = seededSource('boundary');
    const { mpk, msk } = setup(2, rng);
    // <x, y> = 5 * 5 = 25 exactly.
    const x = [5n, 0n];
    const y = [5n, 0n];
    expect(dotProduct(x, y)).toBe(25n);
    const ct = encrypt(mpk, x, rng);
    const key = keyDer(msk, y);

    const inside = decrypt(ct, key, 25n);
    expect(inside.dlog.found).toBe(true);
    if (inside.dlog.found) expect(inside.dlog.value).toBe(25n);

    const outside = decrypt(ct, key, 24n);
    expect(outside.dlog.found).toBe(false);

    // The negative edge, which an asymmetric range would silently lose.
    const xn = [-5n, 0n];
    expect(dotProduct(xn, y)).toBe(-25n);
    const ctn = encrypt(mpk, xn, rng);
    const insideNeg = decrypt(ctn, key, 25n);
    expect(insideNeg.dlog.found).toBe(true);
    if (insideNeg.dlog.found) expect(insideNeg.dlog.value).toBe(-25n);
    expect(decrypt(ctn, key, 24n).dlog.found).toBe(false);
  });

  it('a failed search leaves no value field to misread', () => {
    const r = dlogSymmetric(scalarMulBase(1000n), 10n);
    expect(r.found).toBe(false);
    expect('value' in r).toBe(false);
  });
});

describe('KeyDer', () => {
  it('sk_y is <y, s> reduced mod l, recomputed here from msk', () => {
    const rng = seededSource('keyder');
    const { msk } = setup(4, rng);
    const y = [3n, -7n, 2n, 5n];
    const key = keyDer(msk, y);
    // Independent recomputation from the raw s, including the reduction.
    let acc = 0n;
    for (let i = 0; i < 4; i++) acc += y[i] * msk.s[i];
    const expected = ((acc % GROUP_ORDER) + GROUP_ORDER) % GROUP_ORDER;
    expect(key.sk).toBe(expected);
    expect(key.sk).toBeGreaterThanOrEqual(0n);
    expect(key.sk).toBeLessThan(GROUP_ORDER);
  });

  it('y = 0 gives sk = 0 and the key still works, answering 0', () => {
    const rng = seededSource('zero-key');
    const { mpk, msk } = setup(4, rng);
    const key = keyDer(msk, [0n, 0n, 0n, 0n]);
    expect(key.sk).toBe(0n);
    const result = decrypt(encrypt(mpk, [7n, -2n, 3n, 9n], rng), key, 64n);
    expect(result.dlog.found).toBe(true);
    if (result.dlog.found) expect(result.dlog.value).toBe(0n);
  });

  it('the reduction is a real mod, not JavaScript % (negative inner products)', () => {
    const rng = seededSource('negative-sk');
    const { msk } = setup(2, rng);
    // Force a negative raw inner product by negating y.
    const y = [-1n, 0n];
    const key = keyDer(msk, y);
    const raw = -msk.s[0];
    expect(raw).toBeLessThan(0n);
    expect(key.sk).toBe(toScalar(raw));
    expect(key.sk).toBeGreaterThan(0n);
  });

  it('rejects a y of the wrong length instead of padding it', () => {
    const { msk } = setup(4, seededSource('len'));
    expect(() => keyDer(msk, [1n, 2n])).toThrow(/length/);
  });
});

describe('Setup and Encrypt argument checking', () => {
  it('mpk carries h_i = g^{s_i}, checked element by element', () => {
    const { mpk, msk } = setup(5, seededSource('mpk'));
    for (let i = 0; i < 5; i++) {
      expect(equals(mpk.h[i], scalarMulBase(msk.s[i]))).toBe(true);
    }
  });

  it('refuses a dimension over the cap or under 1', () => {
    expect(() => setup(MAX_N + 1, seededSource('cap'))).toThrow(/cap/);
    expect(() => setup(0, seededSource('cap'))).toThrow(/positive/);
  });

  it('refuses an x of the wrong length', () => {
    const { mpk } = setup(4, seededSource('xlen'));
    expect(() => encrypt(mpk, [1n, 2n, 3n], seededSource('xlen'))).toThrow(/length/);
  });
});

describe('Invariant 9 — additive malleability (CPA only)', () => {
  it('the componentwise product decrypts to <x + x\', y>', () => {
    const rng = seededSource('malleable');
    const { mpk, msk } = setup(4, rng);
    const x = [2n, 1n, 3n, 0n];
    const xp = [1n, 4n, -2n, 5n];
    const y = [3n, 1n, 2n, 1n];
    const key = keyDer(msk, y);

    const combined = combineCiphertexts(encrypt(mpk, x, rng), encrypt(mpk, xp, rng));
    const result = decrypt(combined, key, 512n);

    // The expected answer, computed here: sum of the two dot products, which is
    // also the dot product of the summed vector.
    const sum = x.map((v, i) => v + xp[i]);
    const expected = dotProduct(sum, y);
    expect(expected).toBe(dotProduct(x, y) + dotProduct(xp, y));

    expect(result.dlog.found).toBe(true);
    if (result.dlog.found) expect(result.dlog.value).toBe(expected);
  });

  it('the mauled ciphertext is well-formed: nothing reports an error', () => {
    // This is the exhibit. Every check the scheme performs succeeds, because a
    // sum of two valid ciphertexts IS a valid ciphertext. There is no integrity
    // check to fail, and the absence of one is the finding.
    const rng = seededSource('malleable-valid');
    const { mpk, msk } = setup(3, rng);
    const combined = combineCiphertexts(
      encrypt(mpk, [1n, 1n, 1n], rng),
      encrypt(mpk, [2n, 2n, 2n], rng),
    );
    const result = decrypt(combined, keyDer(msk, [1n, 1n, 1n]), 512n);
    expect(result.dlog.found).toBe(true);
    if (result.dlog.found) expect(result.dlog.value).toBe(9n); // <(3,3,3),(1,1,1)>
  });

  it('refuses to combine ciphertexts of different dimension', () => {
    const rng = seededSource('mismatch');
    const a = setup(3, rng);
    const b = setup(4, rng);
    expect(() =>
      combineCiphertexts(encrypt(a.mpk, [1n, 1n, 1n], rng), encrypt(b.mpk, [1n, 1n, 1n, 1n], rng)),
    ).toThrow(/dimension mismatch/);
  });
});

describe('the partial-knowledge fixture is built as claimed', () => {
  it('xA and xB differ, and their difference is orthogonal to every key y', () => {
    const { xA, xB, difference, keys } = PARTIAL_KNOWLEDGE;
    expect(xA).not.toEqual(xB);
    expect(xA.map((v, i) => v - xB[i])).toEqual([...difference]);
    for (const k of keys) {
      expect(dotProduct(difference, k.y)).toBe(0n);
    }
  });

  it('both x produce exactly the fixture\'s claimed outputs, through the real scheme', () => {
    const { n, xA, xB, keys, seed } = PARTIAL_KNOWLEDGE;
    const rng = seededSource(seed);
    const { mpk, msk } = setup(n, rng);
    const ctA = encrypt(mpk, xA, rng);
    const ctB = encrypt(mpk, xB, rng);
    for (const k of keys) {
      const key = keyDer(msk, k.y);
      const a = decrypt(ctA, key, DEFAULT_BOUND);
      const b = decrypt(ctB, key, DEFAULT_BOUND);
      expect(a.dlog.found && b.dlog.found).toBe(true);
      if (a.dlog.found && b.dlog.found) {
        expect(a.dlog.value).toBe(k.output);
        expect(b.dlog.value).toBe(k.output);
        expect(a.dlog.value).toBe(dotProduct(xA, k.y));
        expect(b.dlog.value).toBe(dotProduct(xB, k.y));
      }
    }
  });
});

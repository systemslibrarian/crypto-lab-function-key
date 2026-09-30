/**
 * Invariants 5 through 8 — what keys yield, and what they refuse to yield.
 *
 * Everything here runs against the REAL scheme: keys come from `keyDer`,
 * outputs come from `decrypt`. Nothing recomputes an inner product by a second
 * path inside the lab and then congratulates itself on agreement.
 */

import { describe, it, expect } from 'vitest';
import { decrypt, encrypt, keyDer, setup } from './ipfe';
import { seededSource } from './prng';
import { fToString } from './linalg';
import { GROUP_ORDER, equals, scalarMulBase } from './ristretto';
import {
  forgeKey,
  knowledgeFrom,
  ranks,
  recoverMasterSecret,
  WHY_PERMITTED,
  type Observation,
} from './attacks';
import {
  COMPLETING_KEYS_A,
  DEFAULT_BOUND,
  FULL_RANK_YS,
  NEVER_ISSUED_Y,
  PARTIAL_KNOWLEDGE,
  RANK_DEFICIENT_YS,
} from './fixtures';

function dotProduct(x: readonly bigint[], y: readonly bigint[]): bigint {
  let acc = 0n;
  for (let i = 0; i < x.length; i++) acc += x[i] * y[i];
  return acc;
}

/** Run the real scheme and collect genuine (y, output) observations. */
function observe(
  x: readonly bigint[],
  ys: readonly (readonly bigint[])[],
  seed: string,
): { observations: Observation[]; keys: ReturnType<typeof keyDer>[]; s: readonly bigint[] } {
  const n = x.length;
  const rng = seededSource(seed);
  const { mpk, msk } = setup(n, rng);
  const ct = encrypt(mpk, x, rng);
  const observations: Observation[] = [];
  const keys: ReturnType<typeof keyDer>[] = [];
  for (const y of ys) {
    const key = keyDer(msk, y);
    keys.push(key);
    const r = decrypt(ct, key, DEFAULT_BOUND);
    if (!r.dlog.found) throw new Error(`fixture out of range for y=${y}`);
    observations.push({ y, output: r.dlog.value });
  }
  return { observations, keys, s: msk.s };
}

describe('Invariant 5 — k < n keys do not determine x', () => {
  const { n, xA, xB, keys } = PARTIAL_KNOWLEDGE;

  it('with 2 of 4 keys the solution set has dimension 2 and x is not pinned', () => {
    const { observations } = observe(xA, keys.map((k) => k.y), PARTIAL_KNOWLEDGE.seed);
    const state = knowledgeFrom(observations, n);
    expect(state.rank).toBe(2);
    expect(state.dimension).toBe(2);
    expect(state.pinned).toBe(false);
    // The rule the UI depends on: no single x is available to draw.
    expect(state.recovered).toBeNull();
  });

  it('BOTH distinct x are in the reported family — the evidence fixture', () => {
    const { observations } = observe(xA, keys.map((k) => k.y), PARTIAL_KNOWLEDGE.seed);
    const state = knowledgeFrom(observations, n);
    expect(state.solution.kind).toBe('solutions');
    if (state.solution.kind !== 'solutions') return;

    // Solve for the coefficients that should reproduce each x, then check the
    // family actually contains it. This is the assertion that makes "does not
    // determine x" a result instead of a disclaimer.
    const inFamily = (target: readonly bigint[]): boolean => {
      const { particular, nullSpace } = state.solution as Extract<
        typeof state.solution,
        { kind: 'solutions' }
      >;
      // Residual = target - particular, expressed in the null-space basis.
      // With free columns being coordinate directions, the coefficient for
      // basis vector j is simply the residual at that free column.
      const freeCols = (state.solution as Extract<typeof state.solution, { kind: 'solutions' }>)
        .freeColumns;
      const coeffs = freeCols.map((c) => {
        const p = particular[c];
        // target[c] - particular[c], as an exact rational numerator over den 1.
        return { num: target[c] * p.den - p.num, den: p.den };
      });
      for (let i = 0; i < n; i++) {
        let accNum = particular[i].num;
        let accDen = particular[i].den;
        nullSpace.forEach((v, j) => {
          const t = coeffs[j];
          // acc += t * v[i]
          const addNum = t.num * v[i].num;
          const addDen = t.den * v[i].den;
          accNum = accNum * addDen + addNum * accDen;
          accDen = accDen * addDen;
        });
        if (accNum !== target[i] * accDen) return false;
      }
      return true;
    };

    expect(inFamily(xA)).toBe(true);
    expect(inFamily(xB)).toBe(true);
    expect(xA).not.toEqual(xB);
  });

  it('both x really do produce identical outputs under those keys, via the scheme', () => {
    const a = observe(xA, keys.map((k) => k.y), 'both/a');
    const b = observe(xB, keys.map((k) => k.y), 'both/b');
    expect(a.observations.map((o) => o.output)).toEqual(b.observations.map((o) => o.output));
    // And those outputs are the fixture's claimed ones, computed here.
    keys.forEach((k, i) => {
      expect(a.observations[i].output).toBe(dotProduct(xA, k.y));
      expect(b.observations[i].output).toBe(dotProduct(xB, k.y));
      expect(a.observations[i].output).toBe(k.output);
    });
  });

  it('the dimension shrinks by one per independent key, from n to 0', () => {
    const ys = [...keys.map((k) => k.y), ...COMPLETING_KEYS_A.map((k) => k.y)];
    const { observations } = observe(xA, ys, 'shrink');
    const seen: number[] = [knowledgeFrom([], n).dimension];
    for (let k = 1; k <= observations.length; k++) {
      seen.push(knowledgeFrom(observations.slice(0, k), n).dimension);
    }
    expect(seen).toEqual([4, 3, 2, 1, 0]);
  });

  it('no key at all means every x is possible', () => {
    const state = knowledgeFrom([], 4);
    expect(state.rank).toBe(0);
    expect(state.dimension).toBe(4);
    expect(state.pinned).toBe(false);
  });

  it('a duplicate key does not shrink the family', () => {
    const y = keys[0].y;
    const { observations } = observe(xA, [y, y, y], 'dupes');
    const state = knowledgeFrom(observations, n);
    expect(state.rank).toBe(1);
    expect(state.dimension).toBe(3);
    expect(state.pinned).toBe(false);
  });
});

describe('Invariant 6 — n independent keys recover x exactly', () => {
  it('recovers x, and every coordinate is an exact integer', () => {
    const x = [2n, 3n, 1n, 4n];
    const { observations } = observe(x, FULL_RANK_YS, 'recover-x');
    const state = knowledgeFrom(observations, 4);
    expect(state.rank).toBe(4);
    expect(state.dimension).toBe(0);
    expect(state.pinned).toBe(true);
    expect(state.recovered).not.toBeNull();
    expect(state.recovered?.map(fToString)).toEqual(['2', '3', '1', '4']);
    // Exact: denominators are all 1, so nothing was rounded into place.
    for (const f of state.recovered ?? []) expect(f.den).toBe(1n);
  });

  it('recovers a signed x too', () => {
    const x = [-5n, 7n, -2n, 0n];
    const { observations } = observe(x, FULL_RANK_YS, 'recover-signed');
    const state = knowledgeFrom(observations, 4);
    expect(state.pinned).toBe(true);
    expect(state.recovered?.map(fToString)).toEqual(['-5', '7', '-2', '0']);
  });

  it('the recovered x reproduces every observed output, checked independently', () => {
    const x = [1n, -4n, 6n, 2n];
    const { observations } = observe(x, FULL_RANK_YS, 'recover-consistent');
    const state = knowledgeFrom(observations, 4);
    expect(state.pinned).toBe(true);
    const recovered = (state.recovered ?? []).map((f) => {
      expect(f.den).toBe(1n);
      return f.num;
    });
    for (const o of observations) {
      expect(dotProduct(recovered, o.y)).toBe(o.output);
    }
  });

  /**
   * A corrupted output is NOT detectable from exactly n independent keys, and
   * saying otherwise would be the "right conclusion, wrong chain" error. With n
   * independent y the system is square and full rank, so it is invertible: EVERY
   * right-hand side has exactly one solution. Corruption therefore moves the
   * answer silently rather than producing a contradiction.
   *
   * Detecting it needs redundancy — more than n observations — which is the case
   * below it.
   */
  it('a corrupted output with exactly n keys yields a DIFFERENT x, silently', () => {
    const x = [2n, 3n, 1n, 4n];
    const { observations } = observe(x, FULL_RANK_YS, 'corrupt-square');
    const broken = observations.map((o, i) => (i === 0 ? { ...o, output: o.output + 1n } : o));
    const state = knowledgeFrom(broken, 4);

    // Still pinned, still consistent, still integral — and wrong.
    expect(state.inconsistent).toBe(false);
    expect(state.pinned).toBe(true);
    expect(state.recovered).not.toBeNull();
    expect(state.recovered?.map(fToString)).not.toEqual(['2', '3', '1', '4']);
    // It is not even non-integral here, so integrality is not a reliable tell.
    expect(state.recovered?.every((f) => f.den === 1n)).toBe(true);
  });

  it('inconsistency IS detected once the observations are overdetermined', () => {
    const x = [2n, 3n, 1n, 4n];
    // n + 1 observations: the extra one is the redundancy that makes a
    // contradiction visible.
    const ys = [...FULL_RANK_YS, [1n, 1n, 1n, 1n] as readonly bigint[]];
    const { observations } = observe(x, ys, 'corrupt-overdetermined');
    const state0 = knowledgeFrom(observations, 4);
    expect(state0.inconsistent).toBe(false);
    expect(state0.pinned).toBe(true);

    const broken = observations.map((o, i) => (i === 0 ? { ...o, output: o.output + 1n } : o));
    const state = knowledgeFrom(broken, 4);
    expect(state.inconsistent).toBe(true);
    expect(state.pinned).toBe(false);
    expect(state.recovered).toBeNull();
  });
});

describe('Invariant 7 — master-secret recovery from keys alone', () => {
  it('recovers s from n independent keys with NO ciphertext', () => {
    const rng = seededSource('master-recovery');
    const { msk } = setup(4, rng);
    // Only (y, sk) pairs are handed over. No encryption happens in this test.
    const keys = FULL_RANK_YS.map((y) => keyDer(msk, y));
    const rec = recoverMasterSecret(keys, 4);
    expect(rec.kind).toBe('recovered');
    if (rec.kind !== 'recovered') return;
    expect(rec.rank).toBe(4);
    expect(rec.s).toEqual([...msk.s]);
  });

  it('the recovered s derives a working key for a vector never issued', () => {
    const rng = seededSource('forge');
    const { mpk, msk } = setup(4, rng);
    const issuedYs = FULL_RANK_YS;
    const keys = issuedYs.map((y) => keyDer(msk, y));

    // The authority never issues NEVER_ISSUED_Y.
    expect(issuedYs.some((y) => y.every((v, i) => v === NEVER_ISSUED_Y[i]))).toBe(false);

    const rec = recoverMasterSecret(keys, 4);
    expect(rec.kind).toBe('recovered');
    if (rec.kind !== 'recovered') return;

    const forged = forgeKey(rec.s, NEVER_ISSUED_Y);
    // The proof: a FRESH ciphertext, decrypted under the forged key, gives the
    // right answer. Comparing s arrays would only show two arrays match.
    const x = [4n, -1n, 3n, 2n];
    const fresh = encrypt(mpk, x, rng);
    const result = decrypt(fresh, forged, DEFAULT_BOUND);
    expect(result.dlog.found).toBe(true);
    if (result.dlog.found) {
      expect(result.dlog.value).toBe(dotProduct(x, NEVER_ISSUED_Y));
    }
  });

  it('the forged key is byte-identical to one the authority would have issued', () => {
    const rng = seededSource('forge-identical');
    const { msk } = setup(4, rng);
    const keys = FULL_RANK_YS.map((y) => keyDer(msk, y));
    const rec = recoverMasterSecret(keys, 4);
    if (rec.kind !== 'recovered') throw new Error('expected recovery');
    expect(forgeKey(rec.s, NEVER_ISSUED_Y).sk).toBe(keyDer(msk, NEVER_ISSUED_Y).sk);
  });

  it('recovered scalars are in [0, l)', () => {
    const rng = seededSource('range');
    const { msk } = setup(4, rng);
    const rec = recoverMasterSecret(FULL_RANK_YS.map((y) => keyDer(msk, y)), 4);
    if (rec.kind !== 'recovered') throw new Error('expected recovery');
    for (const v of rec.s) {
      expect(v).toBeGreaterThanOrEqual(0n);
      expect(v).toBeLessThan(GROUP_ORDER);
    }
  });

  it('and h_i = g^{s_i} holds for the recovered s, against the published mpk', () => {
    const rng = seededSource('mpk-check');
    const { mpk, msk } = setup(4, rng);
    const rec = recoverMasterSecret(FULL_RANK_YS.map((y) => keyDer(msk, y)), 4);
    if (rec.kind !== 'recovered') throw new Error('expected recovery');
    // An independent confirmation that does not look at msk at all: the
    // recovered scalars must reproduce the public key.
    rec.s.forEach((si, i) => {
      expect(equals(scalarMulBase(si), mpk.h[i])).toBe(true);
    });
  });
});

describe('Invariant 8 — dependence detection', () => {
  it('refuses recovery on a rank-deficient key set and reports the rank', () => {
    const rng = seededSource('deficient');
    const { msk } = setup(4, rng);
    const keys = RANK_DEFICIENT_YS.map((y) => keyDer(msk, y));
    expect(keys).toHaveLength(4); // four keys...
    const rec = recoverMasterSecret(keys, 4);
    expect(rec.kind).toBe('rank-deficient'); // ...and still not enough
    if (rec.kind !== 'rank-deficient') return;
    expect(rec.rank).toBe(2);
    expect(rec.needed).toBe(4);
    // Crucially: no `s` field to display.
    expect('s' in rec).toBe(false);
  });

  it('a scalar multiple and an exact duplicate each add no rank', () => {
    expect(ranks(RANK_DEFICIENT_YS, 4)).toEqual({ overQ: 2, modL: 2 });
    expect(ranks(FULL_RANK_YS, 4)).toEqual({ overQ: 4, modL: 4 });
    expect(ranks([[1n, 1n, 0n, 0n], [2n, 2n, 0n, 0n]], 4).overQ).toBe(1);
  });

  it('an empty key set is rank 0, not an error', () => {
    const rec = recoverMasterSecret([], 4);
    expect(rec.kind).toBe('rank-deficient');
    if (rec.kind === 'rank-deficient') expect(rec.rank).toBe(0);
    expect(ranks([], 4)).toEqual({ overQ: 0, modL: 0 });
  });

  it('adding the missing independent keys turns refusal into recovery', () => {
    const rng = seededSource('deficient-then-full');
    const { msk } = setup(4, rng);
    const deficient = RANK_DEFICIENT_YS.map((y) => keyDer(msk, y));
    expect(recoverMasterSecret(deficient, 4).kind).toBe('rank-deficient');
    const completed = [...deficient, keyDer(msk, [0n, 1n, 0n, 0n]), keyDer(msk, [0n, 0n, 0n, 1n])];
    const rec = recoverMasterSecret(completed, 4);
    expect(rec.kind).toBe('recovered');
    if (rec.kind === 'recovered') expect(rec.s).toEqual([...msk.s]);
  });
});

describe('the "why this is permitted" statement', () => {
  it('names what it does NOT claim, so the copy cannot quietly widen', () => {
    // Guards against the failure the brief calls out: a right conclusion
    // reached through a wrong causal chain. If someone deletes the scoping, the
    // page loses it and this test notices.
    expect(WHY_PERMITTED.notClaimed).toMatch(/adaptively secure/);
    expect(WHY_PERMITTED.notClaimed).toMatch(/collusion is harmless/i);
    expect(WHY_PERMITTED.chain).toHaveLength(3);
    expect(WHY_PERMITTED.chain[0]).toMatch(/<x0, y> = <x1, y>/);
    expect(WHY_PERMITTED.short).toMatch(/independent/);
  });

  it('the mathematical claim in the chain is actually true, as a check not a quote', () => {
    // "n independent y with <x0,y> = <x1,y> force x0 = x1" -- i.e. a vector
    // orthogonal to a full-rank set is zero. Verified over the lab's own
    // solver rather than taken on trust from the prose.
    const n = 4;
    const state = knowledgeFrom(
      FULL_RANK_YS.map((y) => ({ y, output: 0n })),
      n,
    );
    expect(state.pinned).toBe(true);
    expect(state.recovered?.every((f) => f.num === 0n)).toBe(true);
  });
});

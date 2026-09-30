/**
 * Invariants 5 through 8 — what keys yield, and what they refuse to yield.
 *
 * Everything here runs against the REAL scheme: keys come from `keyDer`,
 * outputs come from `decrypt`. Nothing recomputes an inner product by a second
 * path inside the lab and then congratulates itself on agreement.
 */

import { describe, it, expect } from 'vitest';
import { decrypt, encrypt, keyDer, recoverFullVector, setup } from './ipfe';
import { seededSource } from './prng';
import { fToString } from './linalg';
import { GROUP_ORDER, equals, scalarMulBase } from './ristretto';
import {
  forgeKey,
  isConsistent,
  knowledgeFrom,
  ranks,
  recoverMasterSecret,
  sampleCandidates,
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

/* ------------------------------------------------------------------ *
 * Candidate generation — the acceptance test for the ordering defect
 * ------------------------------------------------------------------ */

describe('sampleCandidates: valid for EVERY key subset and order', () => {
  // The four y vectors exhibit 4 offers, in the order it offers them.
  const OFFERS: readonly (readonly bigint[])[] = [
    PARTIAL_KNOWLEDGE.keys[0].y,
    PARTIAL_KNOWLEDGE.keys[1].y,
    [1n, 0n, 0n, 0n],
    [0n, 0n, 1n, 0n],
  ];

  /** Run the real scheme over one subset and return the observations. */
  function observeSubset(indices: readonly number[]): Observation[] {
    const { n, xA, seed } = PARTIAL_KNOWLEDGE;
    const rng = seededSource(seed);
    const pair = setup(n, rng);
    const ct = encrypt(pair.mpk, xA, rng);
    return indices.map((i) => {
      const y = OFFERS[i];
      const r = decrypt(ct, keyDer(pair.msk, y), DEFAULT_BOUND);
      if (!r.dlog.found) throw new Error(`fixture out of range for offer ${i}`);
      return { y, output: r.dlog.value };
    });
  }

  /**
   * ALL 15 NON-EMPTY SUBSETS. The defect this replaces was reachable in 7 of
   * them, and the shipped test only ever clicked "the first available button",
   * which walks exactly one of the 24 orders.
   */
  it('every non-empty subset below full rank yields two distinct consistent candidates', () => {
    let belowFullRank = 0;
    let pinned = 0;

    for (let mask = 1; mask < 16; mask++) {
      const idx = [0, 1, 2, 3].filter((i) => mask & (1 << i));
      const obs = observeSubset(idx);
      const state = knowledgeFrom(obs, 4);
      const pair = sampleCandidates(state);
      const label = `subset {${idx.join(',')}}`;

      if (state.pinned) {
        pinned++;
        // At full rank there is one point and therefore no second candidate.
        expect(pair, `${label}: a pinned state must offer no second candidate`).toBeNull();
        continue;
      }

      belowFullRank++;
      expect(pair, `${label}: an unpinned state must offer two candidates`).not.toBeNull();
      if (!pair) continue;

      // Both satisfy EVERY observation held, checked against the raw
      // observations rather than against the solver that produced them.
      expect(isConsistent(pair.first, obs), `${label}: candidate 1 consistent`).toBe(true);
      expect(isConsistent(pair.second, obs), `${label}: candidate 2 consistent`).toBe(true);

      // And they are genuinely different vectors.
      const same = pair.first.every(
        (f, i) => f.num === pair.second[i].num && f.den === pair.second[i].den,
      );
      expect(same, `${label}: the two candidates must differ`).toBe(false);
    }

    expect(belowFullRank, 'subsets below full rank').toBe(14);
    expect(pinned, 'subsets at full rank').toBe(1);
  });

  /** ALL 24 ORDERS of the full key set, checked at every prefix. */
  it('every request order is truthful at every rank along the way', () => {
    const perms: number[][] = [];
    const permute = (rest: number[], acc: number[]): void => {
      if (rest.length === 0) {
        perms.push(acc);
        return;
      }
      rest.forEach((v, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, v]));
    };
    permute([0, 1, 2, 3], []);
    expect(perms).toHaveLength(24);

    for (const order of perms) {
      for (let k = 1; k <= order.length; k++) {
        const idx = order.slice(0, k);
        const obs = observeSubset(idx);
        const state = knowledgeFrom(obs, 4);
        const pair = sampleCandidates(state);
        const label = `order [${order.join('')}] prefix ${k}`;

        // Rank and dimension must always account for each other.
        expect(state.dimension, `${label}: dimension must be n - rank`).toBe(4 - state.rank);

        if (state.pinned) {
          expect(state.rank, `${label}: pinned means full rank`).toBe(4);
          expect(pair, `${label}: no second candidate when pinned`).toBeNull();
          // And the one point is the vector that was actually encrypted.
          expect(state.recovered?.map((f) => f.num)).toEqual([...PARTIAL_KNOWLEDGE.xA]);
          expect(state.recovered?.every((f) => f.den === 1n)).toBe(true);
        } else {
          expect(pair, `${label}: two candidates below full rank`).not.toBeNull();
          if (!pair) continue;
          expect(isConsistent(pair.first, obs), `${label}: candidate 1`).toBe(true);
          expect(isConsistent(pair.second, obs), `${label}: candidate 2`).toBe(true);
        }
      }
    }
  });

  it('isConsistent is a real test, not one that always agrees', () => {
    const obs = observeSubset([0, 1]);
    const state = knowledgeFrom(obs, 4);
    const pair = sampleCandidates(state);
    expect(pair).not.toBeNull();
    if (!pair) return;
    // A vector nudged off the family must be reported inconsistent.
    const off = pair.first.map((f, i) => (i === 0 ? { num: f.num + 1n, den: f.den } : f));
    expect(isConsistent(off, obs)).toBe(false);
  });
});

describe('recoverFullVector: the authority reads x the only way the scheme allows', () => {
  it('recovers every coordinate through a real basis-key decryption', () => {
    const rng = seededSource('full-vector');
    const { mpk, msk } = setup(5, rng);
    const x = [3n, -7n, 0n, 9n, -1n];
    const ct = encrypt(mpk, x, rng);

    const results = recoverFullVector(msk, ct, DEFAULT_BOUND);
    expect(results).toHaveLength(5);
    results.forEach((r, i) => {
      expect(r.dlog.found, `coordinate ${i}`).toBe(true);
      if (r.dlog.found) expect(r.dlog.value).toBe(x[i]);
    });
  });

  it('is the same mechanism as the analyst uses, just with a basis', () => {
    // <x, e_i> = x_i, so each coordinate is an ordinary functional-key answer.
    // Asserted here because it is the lab's central symmetry.
    const rng = seededSource('symmetry');
    const { mpk, msk } = setup(4, rng);
    const x = [2n, 5n, -3n, 8n];
    const ct = encrypt(mpk, x, rng);

    const viaBasis = recoverFullVector(msk, ct, DEFAULT_BOUND);
    for (let i = 0; i < 4; i++) {
      const e = [0n, 0n, 0n, 0n];
      e[i] = 1n;
      const asAnalyst = decrypt(ct, keyDer(msk, e), DEFAULT_BOUND).dlog;
      // Bound to locals: TypeScript cannot narrow a discriminated union
      // through an indexed access, so `viaBasis[i].dlog` stays the wide type.
      const viaBasisI = viaBasis[i].dlog;
      expect(asAnalyst.found).toBe(true);
      expect(viaBasisI.found).toBe(true);
      if (asAnalyst.found && viaBasisI.found) {
        expect(viaBasisI.value).toBe(asAnalyst.value);
        expect(viaBasisI.value).toBe(x[i]);
      }
    }
  });

  it('refuses a ciphertext of the wrong dimension', () => {
    const rng = seededSource('dim');
    const a = setup(3, rng);
    const b = setup(4, rng);
    expect(() => recoverFullVector(a.msk, encrypt(b.mpk, [1n, 1n, 1n, 1n], rng), 64n)).toThrow(
      /does not match/,
    );
  });

  it('reports a failed search rather than guessing when a coordinate is out of range', () => {
    const rng = seededSource('oor-coord');
    const { mpk, msk } = setup(2, rng);
    const ct = encrypt(mpk, [9n, 1n], rng);
    const results = recoverFullVector(msk, ct, 2n); // 9 is outside [-2, 2]
    expect(results[0].dlog.found).toBe(false);
    expect(results[1].dlog.found).toBe(true);
  });
});

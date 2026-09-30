/**
 * Pinned fixtures.
 *
 * No standardized IPFE test vectors exist to this author's knowledge, so
 * nothing here is labelled "official" and nothing claims to come from a
 * standards body. These are deterministic fixtures for this lab: the seed
 * fixes s and r, so a run is reproducible, and every claimed value is
 * cross-checked in the tests by a plain integer dot product computed there,
 * not imported from `ipfe.ts`.
 *
 * On the FENTEC option in the brief: GoFE and CiFEr both implement an ABDP15
 * DDH IPFE, but over a Z_p^* / Schnorr-style group with its own encoding, not
 * over ristretto255. There is no encoding under which their group elements and
 * ours are the same bytes, so importing their outputs would require
 * re-deriving them in our group, which is exactly the "approximate it" move
 * the brief says to skip. Skipped, and recorded here as the reason. The group
 * layer's trust anchor is RFC 9496 Appendix A instead, which IS published and
 * IS pinnable (see `rfc9496-vectors.ts`).
 *
 * ONE ROW HERE IS DELIBERATELY WRONG. `WRONG_ON_PURPOSE` claims an inner
 * product that is not the inner product of its own x and y. It is rendered on
 * the page as a row like any other and the page must report it as failing. A
 * checker only ever seen agreeing cannot be trusted: if every fixture passes,
 * a mutation forcing the comparison true changes nothing observable and the
 * whole table proves nothing. Do not "fix" this row.
 */

import type { Observation } from './attacks';

/** A correctness row: the page computes <x,y> by the scheme and compares. */
export interface CorrectnessFixture {
  readonly id: string;
  readonly label: string;
  readonly n: number;
  readonly x: readonly bigint[];
  readonly y: readonly bigint[];
  /** What this row asserts the inner product is. */
  readonly claimed: bigint;
  readonly seed: string;
  /** Set on the one row that is wrong on purpose. */
  readonly wrongOnPurpose?: true;
  readonly note: string;
}

export const WRONG_ON_PURPOSE = 'wrong-on-purpose';

export const CORRECTNESS_FIXTURES: readonly CorrectnessFixture[] = [
  {
    id: 'plain',
    label: 'Ordinary vector',
    n: 4,
    x: [3n, 1n, 4n, 1n],
    y: [2n, 0n, 1n, 5n],
    claimed: 15n, // 6 + 0 + 4 + 5
    seed: 'function-key/fixture/plain',
    note: 'All entries positive. The baseline row.',
  },
  {
    id: 'negative-entries',
    label: 'Signed entries',
    n: 4,
    x: [-3n, 5n, -1n, 2n],
    y: [4n, -2n, 6n, 1n],
    claimed: -26n, // -12 - 10 - 6 + 2
    seed: 'function-key/fixture/negative',
    note: 'Both vectors mix signs; the inner product is negative, so the symmetric search range is what finds it.',
  },
  {
    id: 'zero-y',
    label: 'y = 0 (edge case)',
    n: 4,
    x: [7n, -2n, 3n, 9n],
    y: [0n, 0n, 0n, 0n],
    claimed: 0n,
    seed: 'function-key/fixture/zero-y',
    note: 'sk_y = 0 and the answer is 0. Hands the group a zero scalar, which the raw library call rejects.',
  },
  {
    id: 'zero-product',
    label: 'Orthogonal x and y',
    n: 4,
    x: [2n, 3n, -1n, 4n],
    y: [3n, -2n, 0n, 0n],
    claimed: 0n, // 6 - 6 + 0 + 0
    seed: 'function-key/fixture/orthogonal',
    note: 'Non-zero y, answer still 0: the key was used and revealed only that x is orthogonal to y.',
  },
  {
    id: 'widest',
    label: 'Largest reachable magnitude',
    n: 8,
    x: [9n, 9n, 9n, 9n, 9n, 9n, 9n, 9n],
    y: [9n, 9n, 9n, 9n, 9n, 9n, 9n, 9n],
    claimed: 648n, // 8 * 81
    seed: 'function-key/fixture/widest',
    note: 'n = 8 at the entry cap. 648 is the largest magnitude this lab can produce, which is why the default bound sits above it.',
  },
  {
    id: 'single',
    label: 'n = 1',
    n: 1,
    x: [-7n],
    y: [6n],
    claimed: -42n,
    seed: 'function-key/fixture/single',
    note: 'The degenerate dimension. One key is already full rank here, so one key does determine x.',
  },
  {
    id: WRONG_ON_PURPOSE,
    label: 'Deliberately wrong claim',
    n: 4,
    x: [3n, 1n, 4n, 1n],
    y: [2n, 0n, 1n, 5n],
    // The true inner product of this x and y is 15 (same vectors as 'plain').
    // This row claims 16. The page MUST report it as failing.
    claimed: 16n,
    seed: 'function-key/fixture/wrong',
    wrongOnPurpose: true,
    note: 'This row claims 16 where its own x and y give 15. It is here so that the table is seen disagreeing at least once: a row that only ever agrees is not evidence.',
  },
];

/* ------------------------------------------------------------------ *
 * Invariant 5 — two distinct x that agree on every collected output
 * ------------------------------------------------------------------ */

/**
 * The partial-knowledge fixture: n = 4, two keys, two different x.
 *
 * Built so that xA - xB = (1, -1, 0, 0) is orthogonal to both y vectors. Any
 * key set spanning only vectors orthogonal to that difference produces
 * identical outputs from xA and xB, so no amount of looking at the outputs can
 * separate them. This is the evidence fixture for the negative claim "k < n
 * keys do not determine x".
 */
export const PARTIAL_KNOWLEDGE = {
  n: 4,
  xA: [2n, 3n, 1n, 4n] as readonly bigint[],
  xB: [1n, 4n, 1n, 4n] as readonly bigint[],
  /** xA - xB, orthogonal to every y below. */
  difference: [1n, -1n, 0n, 0n] as readonly bigint[],
  keys: [
    { y: [1n, 1n, 0n, 0n] as readonly bigint[], output: 5n }, // 2+3 = 1+4 = 5
    { y: [0n, 0n, 1n, 2n] as readonly bigint[], output: 9n }, // 1+8 = 1+8 = 9
  ] as readonly Observation[],
  seed: 'function-key/fixture/partial',
} as const;

/**
 * Two more keys that complete the basis, so the same fixture can be driven from
 * dimension 2 down to a single point.
 */
export const COMPLETING_KEYS_A: readonly Observation[] = [
  { y: [1n, 0n, 0n, 0n], output: 2n }, // <xA, e1> = 2
  { y: [0n, 0n, 1n, 0n], output: 1n }, // <xA, e3> = 1
];

/* ------------------------------------------------------------------ *
 * Rank-deficient key sets
 * ------------------------------------------------------------------ */

/**
 * Four keys whose y vectors have rank 2: a duplicate and a scalar multiple.
 * Recovery must refuse and show the rank (Invariant 8).
 */
export const RANK_DEFICIENT_YS: readonly (readonly bigint[])[] = [
  [1n, 1n, 0n, 0n],
  [2n, 2n, 0n, 0n], // 2x the first: adds no rank
  [1n, 1n, 0n, 0n], // exact duplicate: adds no rank
  [0n, 0n, 1n, 0n],
];

/** Four independent y vectors: enough for full reconstruction and for s. */
export const FULL_RANK_YS: readonly (readonly bigint[])[] = [
  [1n, 1n, 0n, 0n],
  [0n, 0n, 1n, 2n],
  [1n, 0n, 0n, 0n],
  [0n, 0n, 1n, 0n],
];

/** A vector the authority never issues, used to prove a recovered s works. */
export const NEVER_ISSUED_Y: readonly bigint[] = [3n, -2n, 5n, 1n];

/* ------------------------------------------------------------------ *
 * Cost-law widths
 * ------------------------------------------------------------------ */

/**
 * Bounds for the cost-law claim. Chosen as powers of four so that the width
 * quadruples each step and a sqrt law should double the op count each step —
 * a ratio a reader can check by eye on the chart.
 */
export const COST_LAW_BOUNDS: readonly bigint[] = [
  4n ** 2n, // 16
  4n ** 3n, // 64
  4n ** 4n, // 256
  4n ** 5n, // 1024
  4n ** 6n, // 4096
  4n ** 7n, // 16384
  4n ** 8n, // 65536
  4n ** 9n, // 262144
];

/** The default search bound: above 648, the largest product this lab can make. */
export const DEFAULT_BOUND = 1024n;

export const MAIN_SEED = 'function-key/main';

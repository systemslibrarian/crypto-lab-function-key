/**
 * Baby-step giant-step over a SYMMETRIC range, with an exact high-level group-call
 * counter.
 *
 * This is the module that makes ABDP15's honest limitation executable. Decrypt
 * gets you g^<x,y>; turning that back into the integer <x,y> is a discrete log,
 * and it only works because the answer is small. The cost of "small" is measured
 * here rather than asserted.
 *
 * SYMMETRY IS LOAD-BEARING. Inner products of signed vectors are routinely
 * negative, so the search range is [-B, B], not [0, B]. The implementation
 * shifts by B once and searches [0, W) with W = 2B + 1, which is what keeps the
 * negative half reachable. An asymmetric range is one of this lab's mutations
 * precisely because it looks harmless and silently loses half the answers.
 */

import {
  GENERATOR,
  IDENTITY,
  add,
  negate,
  scalarMulBase,
  toHex,
  type GroupElement,
} from './ristretto';
import type { DlogOps, DlogResult } from './types';

/**
 * Largest bound offered. Chosen by measurement, not taste.
 *
 * Measured on this machine (Node 26, @noble/curves 2.4.0), worst case being a
 * search that runs to completion without finding anything:
 *
 *   B         table    group calls  worst-case wall clock
 *   2^10         46           93                   ~12 ms
 *   2^16        363          727                   ~74 ms
 *   2^18        725         1451                  ~125 ms
 *   2^20       1449         2899                  ~259 ms
 *   2^21       2049         4099                  ~390 ms   <- the cap
 *
 * 2^21 is where a worst-case miss still returns inside half a second, which is
 * the bar for something a slider drives interactively. Raising it means
 * re-measuring; `dlog.test.ts` asserts the op count at the cap stays in the low
 * thousands so a bump without measurement fails rather than shipping a page
 * that hangs. Wall clock is machine-dependent and labelled as such wherever it
 * is shown; the op count is not.
 */
export const MAX_BOUND = 2n ** 21n;

/** Integer ceil(sqrt(k)) for k >= 0, without floating point. */
export function ceilSqrt(k: bigint): bigint {
  if (k < 0n) throw new Error('ceilSqrt of a negative value');
  if (k < 2n) return k;
  // Newton's method on integers. Converges from above; the final adjustment
  // makes it a ceiling rather than a floor.
  let x = k;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + k / x) / 2n;
  }
  // x is now floor(sqrt(k)).
  return x * x === k ? x : x + 1n;
}

/**
 * The worst-case high-level group-call count for a search over [-B, B], computed from
 * B alone without running a search.
 *
 * This is what the cost chart plots. Two reasons it is the honest quantity:
 * an actual search stops as soon as it finds the answer, so measured cost
 * depends on where the answer happens to sit and would make the curve look
 * ragged for reasons that have nothing to do with W; and a worst case is
 * reproducible across machines in a way wall-clock is not.
 *
 * `dlogSymmetric` charges exactly these operations when the search fails, which
 * `dlog.test.ts` asserts — so this function and the implementation are two
 * surfaces that have to agree, rather than one claim about the other.
 */
export function worstCaseOps(bound: bigint): DlogOps {
  const { babySteps, giantSteps, setup } = plan(bound);
  return { setup, babySteps, giantSteps, total: setup + babySteps + giantSteps };
}

/** Table size (number of baby steps stored) for a given bound. */
export function tableSizeFor(bound: bigint): bigint {
  return plan(bound).tableSize;
}

interface Plan {
  readonly width: bigint;
  readonly tableSize: bigint;
  readonly giantCount: bigint;
  readonly babySteps: number;
  readonly giantSteps: number;
  readonly setup: number;
}

/**
 * Derive the search shape from the bound. Shared by `worstCaseOps` and the
 * search itself so the predicted and charged costs cannot drift apart.
 */
function plan(bound: bigint): Plan {
  if (bound < 0n) throw new Error('bound must be non-negative');
  const width = 2n * bound + 1n;
  const tableSize = ceilSqrt(width);
  const giantCount = (width + tableSize - 1n) / tableSize;
  return {
    width,
    tableSize,
    giantCount,
    // Building the table incrementally from the identity costs one addition per
    // entry after the first.
    babySteps: Number(tableSize - 1n),
    // One addition of the stride per giant step after the first position.
    giantSteps: Number(giantCount - 1n),
    // Four high-level setup calls: two scalar multiplications, one addition,
    // and one negation. g^B supplies the shift and g^tableSize the
    // stride. Counted separately from the loop additions; scalar multiplication is
    // a compound operation, so the total is not a count of field operations, and
    // folding them into the total would blur the law the chart is about.
    setup: 4,
  };
}

/**
 * Solve g^m = target for m in [-B, B], or report that no such m exists.
 *
 * Returns only a representative in the range. The group encodes exponents mod l;
 * the lab caps x and y far below l/2, so an out-of-range lab answer cannot wrap
 * into this interval. This routine cannot distinguish exponents separated by l.
 */
export function dlogSymmetric(target: GroupElement, bound: bigint): DlogResult {
  if (bound > MAX_BOUND) {
    throw new Error(`bound ${bound} exceeds the measured in-browser cap ${MAX_BOUND}`);
  }
  const p = plan(bound);
  let babySteps = 0;
  let giantSteps = 0;

  // Shift the problem to [0, W): g^m = target  <=>  g^(m+B) = target * g^B.
  const shifted = add(target, scalarMulBase(bound));
  const stride = negate(scalarMulBase(p.tableSize));
  const setup = 4;

  // Baby steps: g^j for j in [0, tableSize), keyed by canonical encoding.
  const table = new Map<string, bigint>();
  let cur: GroupElement = IDENTITY;
  table.set(toHex(cur), 0n);
  for (let j = 1n; j < p.tableSize; j++) {
    cur = add(cur, GENERATOR);
    babySteps++;
    // A duplicate key would mean the group had a smaller order than claimed;
    // keeping the FIRST j is the correct reading either way.
    if (!table.has(toHex(cur))) table.set(toHex(cur), j);
  }

  // Giant steps: walk target * g^B down by tableSize each time.
  let gamma = shifted;
  for (let k = 0n; k < p.giantCount; k++) {
    if (k > 0n) {
      gamma = add(gamma, stride);
      giantSteps++;
    }
    const j = table.get(toHex(gamma));
    if (j !== undefined) {
      const shiftedAnswer = k * p.tableSize + j;
      // The table runs to tableSize-1 and the last giant step can overshoot the
      // end of the range, so a hit is only an answer if it lands inside [0, W).
      if (shiftedAnswer < p.width) {
        return {
          found: true,
          value: shiftedAnswer - bound,
          ops: { setup, babySteps, giantSteps, total: setup + babySteps + giantSteps },
          tableSize: Number(p.tableSize),
          width: p.width,
        };
      }
    }
  }

  return {
    found: false,
    reason: 'not-found-in-range',
    ops: { setup, babySteps, giantSteps, total: setup + babySteps + giantSteps },
    tableSize: Number(p.tableSize),
    width: p.width,
  };
}

// [extension] point: an LWE- or Paillier-based IPFE would replace this module
// entirely rather than speed it up -- there the recovery of <x,y> is not a
// search at all. Keeping the dlog behind this one interface is what would make
// that swap a module change instead of a rewrite.

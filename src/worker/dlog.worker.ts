/**
 * The discrete-log search, off the main thread.
 *
 * Why this is a worker and not an inline call: at the top of the bound slider
 * (B = 2^21) a worst-case search costs ~4100 group operations and took roughly
 * 390 ms on the machine this was built on. Run inline, that is 390 ms during
 * which the page cannot repaint, a keystroke cannot land, and the tab list
 * cannot be operated — measured as a blocked main thread while editing a
 * single vector entry. The whole point of the bound slider is to let someone
 * push the cost until it hurts, so the cost has to be visible without the UI
 * appearing broken.
 *
 * It also makes the lab's central timing claim true rather than described.
 * Decryption yields g^<x,y> immediately; recovering the integer is a separate
 * search. Running that search somewhere the page can watch it is what turns
 * "separate" from a sentence into something a visitor experiences.
 *
 * CANCELLATION IS PART OF THE CONTRACT. Every request carries an id and every
 * reply echoes it; the client drops any reply whose id is not the one it is
 * waiting for. Without that, changing x mid-search publishes the previous
 * x's answer next to the new inputs — a stale result that looks authoritative
 * and is wrong.
 */

import { dlogSymmetric, worstCaseOps } from '../crypto/dlog';
import { fromHex } from '../crypto/ristretto';

export interface SearchRequest {
  readonly kind: 'search';
  readonly id: number;
  /** Canonical encoding of the group element to solve for. */
  readonly targetHex: string;
  readonly bound: string;
}

export interface CostRequest {
  readonly kind: 'cost';
  readonly id: number;
  /** Bounds to measure, as decimal strings. */
  readonly bounds: readonly string[];
  /** A target guaranteed not to be in range, so each search runs to completion. */
  readonly missTargetHex: string;
}

export type WorkerRequest = SearchRequest | CostRequest;

export interface SearchReply {
  readonly kind: 'search';
  readonly id: number;
  readonly found: boolean;
  /** Present only when found. Decimal string, because bigint does not survive structured clone in every engine. */
  readonly value?: string;
  readonly ops: { setup: number; babySteps: number; giantSteps: number; total: number };
  readonly tableSize: number;
  readonly width: string;
  readonly elapsedMs: number;
}

export interface CostPointReply {
  readonly bound: string;
  readonly width: string;
  /** Operations ACTUALLY charged by a search that ran to completion. */
  readonly measuredOps: number;
  /** What `worstCaseOps` predicts from the bound alone. */
  readonly predictedOps: number;
  readonly tableSize: number;
  readonly elapsedMs: number;
}

export interface CostReply {
  readonly kind: 'cost';
  readonly id: number;
  readonly points: readonly CostPointReply[];
}

export type WorkerReply = SearchReply | CostReply;

self.addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;

  if (req.kind === 'search') {
    const t0 = performance.now();
    const r = dlogSymmetric(fromHex(req.targetHex), BigInt(req.bound));
    const reply: SearchReply = {
      kind: 'search',
      id: req.id,
      found: r.found,
      ...(r.found ? { value: r.value.toString() } : {}),
      ops: { ...r.ops },
      tableSize: r.tableSize,
      width: r.width.toString(),
      elapsedMs: performance.now() - t0,
    };
    (self as unknown as Worker).postMessage(reply);
    return;
  }

  if (req.kind === 'cost') {
    const target = fromHex(req.missTargetHex);
    const points: CostPointReply[] = req.bounds.map((b) => {
      const bound = BigInt(b);
      const t0 = performance.now();
      // A target outside every bound here, so the search runs to completion and
      // the counter it returns IS the worst case rather than an estimate of it.
      const r = dlogSymmetric(target, bound);
      const elapsedMs = performance.now() - t0;
      if (r.found) {
        throw new Error(
          `cost probe found a value at bound ${b}; the miss target is not outside the range`,
        );
      }
      const predicted = worstCaseOps(bound);
      return {
        bound: b,
        width: r.width.toString(),
        measuredOps: r.ops.babySteps + r.ops.giantSteps,
        predictedOps: predicted.babySteps + predicted.giantSteps,
        tableSize: r.tableSize,
        elapsedMs,
      };
    });
    const reply: CostReply = { kind: 'cost', id: req.id, points };
    (self as unknown as Worker).postMessage(reply);
  }
});

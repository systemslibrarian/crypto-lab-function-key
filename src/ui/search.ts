/**
 * Client for the discrete-log worker: request, cancel, and a synchronous
 * fallback.
 *
 * THE CANCELLATION RULE. Each request gets a monotonically increasing id and
 * the client only accepts a reply whose id equals the latest request it made.
 * Anything older is discarded on arrival. This is what stops a search started
 * against one ciphertext from publishing its answer after the inputs have
 * changed — a stale value rendered beside inputs it does not belong to, which
 * would look authoritative and be wrong.
 *
 * THE FALLBACK IS NOT A SILENT ONE. If workers are unavailable the search runs
 * inline and `degraded` is set, so the page can say the timing demonstration
 * is not running as designed rather than quietly appearing to work.
 */

import { dlogSymmetric, worstCaseOps } from '../crypto/dlog';
import { fromHex, toHex, scalarMulBase, type GroupElement } from '../crypto/ristretto';
import type {
  CostPointReply,
  CostReply,
  SearchReply,
  WorkerReply,
  WorkerRequest,
} from '../worker/dlog.worker';

export type { CostPointReply };

/** A value far outside any bound this lab offers, so a probe never finds it. */
const MISS_TARGET: GroupElement = scalarMulBase(10n ** 15n);

export interface SearchOutcome {
  readonly found: boolean;
  readonly value: bigint | null;
  readonly ops: { setup: number; babySteps: number; giantSteps: number; total: number };
  readonly tableSize: number;
  readonly width: bigint;
  readonly elapsedMs: number;
}

export class DlogSearcher {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (r: WorkerReply) => void>();
  /** The id of the most recent search request; replies older than this are dropped. */
  private latestSearchId = 0;
  readonly degraded: boolean;

  constructor() {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL('../worker/dlog.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      w = null;
    }
    this.worker = w;
    this.degraded = w === null;
    if (w) {
      w.addEventListener('message', (ev: MessageEvent<WorkerReply>) => {
        const resolve = this.pending.get(ev.data.id);
        if (!resolve) return;
        this.pending.delete(ev.data.id);
        resolve(ev.data);
      });
      w.addEventListener('error', () => {
        // A worker that dies takes every waiting caller with it; failing them
        // is better than leaving promises that never settle.
        for (const [, resolve] of this.pending) {
          resolve({ kind: 'search', id: -1 } as unknown as WorkerReply);
        }
        this.pending.clear();
      });
    }
  }

  /** True while a search this client started has not yet been answered. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Abandon every in-flight search. The worker keeps running whatever it is
   * doing — a running synchronous loop cannot be interrupted from outside —
   * but its answer will be discarded on arrival.
   */
  cancelAll(): void {
    this.pending.clear();
    this.latestSearchId = this.nextId;
  }

  /**
   * Solve for the exponent. Resolves to null if the result was superseded by a
   * newer request, which the caller must treat as "no longer the current
   * question" rather than as a failure.
   */
  async search(target: GroupElement, bound: bigint): Promise<SearchOutcome | null> {
    const id = this.nextId++;
    this.latestSearchId = id;

    if (!this.worker) {
      const t0 = performance.now();
      const r = dlogSymmetric(target, bound);
      if (id !== this.latestSearchId) return null;
      return {
        found: r.found,
        value: r.found ? r.value : null,
        ops: { ...r.ops },
        tableSize: r.tableSize,
        width: r.width,
        elapsedMs: performance.now() - t0,
      };
    }

    const req: WorkerRequest = {
      kind: 'search',
      id,
      targetHex: toHex(target),
      bound: bound.toString(),
    };
    const reply = await new Promise<WorkerReply>((resolve) => {
      this.pending.set(id, resolve);
      this.worker?.postMessage(req);
    });

    // Superseded, or the worker died.
    if (id !== this.latestSearchId) return null;
    if (reply.kind !== 'search' || reply.id !== id) return null;
    const s = reply as SearchReply;
    return {
      found: s.found,
      value: s.found && s.value !== undefined ? BigInt(s.value) : null,
      ops: s.ops,
      tableSize: s.tableSize,
      width: BigInt(s.width),
      elapsedMs: s.elapsedMs,
    };
  }

  /**
   * Measure the cost curve by RUNNING a worst-case search at each bound, rather
   * than computing what one would cost.
   *
   * The distinction is the whole reason this exists: the chart's series is
   * labelled with what produced it, and "measured" has to mean a counter a
   * search actually returned. `predictedOps` comes back alongside so the page
   * can show the two agreeing, which is a cross-check rather than a claim.
   */
  async measureCost(bounds: readonly bigint[]): Promise<readonly CostPointReply[]> {
    const id = this.nextId++;
    if (!this.worker) {
      return bounds.map((bound) => {
        const t0 = performance.now();
        const r = dlogSymmetric(MISS_TARGET, bound);
        const predicted = worstCaseOps(bound);
        return {
          bound: bound.toString(),
          width: r.width.toString(),
          measuredOps: r.ops.babySteps + r.ops.giantSteps,
          predictedOps: predicted.babySteps + predicted.giantSteps,
          tableSize: r.tableSize,
          elapsedMs: performance.now() - t0,
        };
      });
    }

    const req: WorkerRequest = {
      kind: 'cost',
      id,
      bounds: bounds.map((b) => b.toString()),
      missTargetHex: toHex(MISS_TARGET),
    };
    const reply = await new Promise<WorkerReply>((resolve) => {
      this.pending.set(id, resolve);
      this.worker?.postMessage(req);
    });
    if (reply.kind !== 'cost') return [];
    return (reply as CostReply).points;
  }
}

/** Re-exported so callers need not reach past this module into the group layer. */
export { fromHex };

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
  private pending = new Map<number, {
    kind: WorkerRequest['kind'];
    resolve: (r: WorkerReply | null) => void;
    reject: (error: Error) => void;
  }>();
  /** The id of the most recent search request; replies older than this are dropped. */
  private latestSearchId = 0;
  degraded: boolean;

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
        const request = this.pending.get(ev.data.id);
        if (!request) return;
        this.pending.delete(ev.data.id);
        request.resolve(ev.data);
      });
      const failed = (): void => {
        // Retire the failed worker and settle every waiting operation. A retry
        // uses the disclosed main-thread fallback, not a worker that is dead.
        w.terminate();
        this.worker = null;
        this.degraded = true;
        for (const request of this.pending.values()) {
          request.reject(new Error('The search worker failed; no result is available.'));
        }
        this.pending.clear();
      };
      w.addEventListener('error', failed);
      w.addEventListener('messageerror', failed);
    }
  }

  /** True while a search this client started has not yet been answered. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Abandon in-flight answer searches, but retain the independent cost sweep.
   * The worker keeps running whatever it is
   * doing — a running synchronous loop cannot be interrupted from outside —
   * but its answer will be discarded on arrival.
   */
  cancelSearches(): void {
    for (const [id, request] of this.pending) {
      if (request.kind !== 'search') continue;
      this.pending.delete(id);
      request.resolve(null);
    }
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
    const reply = await new Promise<WorkerReply | null>((resolve, reject) => {
      this.pending.set(id, { kind: 'search', resolve, reject });
      this.worker?.postMessage(req);
    });

    // Superseded, or the worker died.
    if (id !== this.latestSearchId) return null;
    if (reply === null) return null;
    if (reply.kind !== 'search' || reply.id !== id) throw new Error('Unexpected search reply.');
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
    const reply = await new Promise<WorkerReply | null>((resolve, reject) => {
      this.pending.set(id, { kind: 'cost', resolve, reject });
      this.worker?.postMessage(req);
    });
    if (reply?.kind !== 'cost' || reply.id !== id) throw new Error('The cost sweep did not complete.');
    return (reply as CostReply).points;
  }
}

/** Re-exported so callers need not reach past this module into the group layer. */
export { fromHex };

/**
 * Lab state, and the rule that keeps a stale answer off the screen.
 *
 * The decode stage is a small state machine rather than a computed render,
 * because the lab's central claim is about TIME: decryption finishes, and the
 * integer is still not available. A render that produced both in one paint can
 * only describe that; a machine that has an `applied` state with no value in
 * it demonstrates it.
 *
 *   idle      nothing applied yet
 *   applied   g^<x,y> is on screen; no integer exists anywhere
 *   searching the worker is running; still no integer
 *   done      found or refused, with the operation count that got there
 *
 * `generation` is the guard. Every input that changes what the answer MEANS —
 * x, y, n, the bound, a re-encryption — bumps it and resets the machine to
 * idle. A worker reply carrying an older generation is discarded. Without
 * that, editing x mid-search paints the previous x's answer beside the new
 * inputs, which looks authoritative and is wrong.
 */

import { encrypt, setup } from '../crypto/ipfe';
import { systemSource } from '../crypto/prng';
import { DEFAULT_BOUND } from '../crypto/fixtures';
import type { Ciphertext, KeyPair } from '../crypto/types';

export type DecodePhase = 'idle' | 'applied' | 'searching' | 'done';

export interface DecodeResult {
  readonly found: boolean;
  readonly value: bigint | null;
  readonly ops: { setup: number; babySteps: number; giantSteps: number; total: number };
  readonly tableSize: number;
  readonly elapsedMs: number;
  /** The generation this result belongs to; compared before it is rendered. */
  readonly generation: number;
}

export type StageId = 'ask' | 'decode' | 'accumulate' | 'cross' | 'evidence';

export const STAGES: readonly StageId[] = ['ask', 'decode', 'accumulate', 'cross', 'evidence'];

export const STAGE_TITLES: Readonly<Record<StageId, string>> = {
  ask: 'Ask one question',
  decode: 'Decode the bounded answer',
  accumulate: 'Watch knowledge accumulate',
  cross: 'Cross the authorization line',
  evidence: 'Evidence',
};

export interface LabState {
  n: number;
  x: bigint[];
  y: bigint[];
  bound: bigint;
  keys: KeyPair;
  ciphertext: Ciphertext;
  previous: Ciphertext | null;

  /** Bumped whenever the current question changes. Guards stale worker replies. */
  generation: number;
  decode: DecodePhase;
  decodeResult: DecodeResult | null;

  /** Measured cost points, filled in by the worker. Null until measured. */
  cost: readonly import('./search').CostPointReply[] | null;
  costPending: boolean;

  /** Indices of the keys issued in stage 3. */
  collected: number[];
  /** Indices of the keys collected in stage 4. */
  aloneCollected: number[];
  /** Set once the reader has overridden the issuance warning in stage 4. */
  overrode: boolean;
}

const DEFAULT_X: readonly bigint[] = [3n, 1n, 4n, 1n];
const DEFAULT_Y: readonly bigint[] = [2n, 0n, 1n, 5n];

export function makeState(): LabState {
  const n = 4;
  const x = [...DEFAULT_X];
  const source = systemSource();
  const keys = setup(n, source);
  return {
    n,
    x,
    y: [...DEFAULT_Y],
    bound: DEFAULT_BOUND,
    keys,
    ciphertext: encrypt(keys.mpk, x, source),
    previous: null,
    generation: 1,
    decode: 'idle',
    decodeResult: null,
    cost: null,
    costPending: false,
    collected: [],
    aloneCollected: [],
    overrode: false,
  };
}

/**
 * Invalidate the current answer. Every caller that changes what <x, y> means
 * must go through here, which is why it is one function rather than three
 * assignments repeated at each call site.
 */
export function invalidate(state: LabState): void {
  state.generation++;
  state.decode = 'idle';
  state.decodeResult = null;
}

export function reencrypt(state: LabState): void {
  state.previous = state.ciphertext;
  state.ciphertext = encrypt(state.keys.mpk, state.x, systemSource());
  invalidate(state);
}

export function regenerate(state: LabState): void {
  const source = systemSource();
  state.keys = setup(state.n, source);
  state.previous = state.ciphertext;
  state.ciphertext = encrypt(state.keys.mpk, state.x, source);
  invalidate(state);
}

/** Change the dimension, refitting x and y and rebuilding the keys. */
export function resize(state: LabState, n: number): void {
  const fit = (v: bigint[]): bigint[] => {
    const out = v.slice(0, n);
    while (out.length < n) out.push(1n);
    return out;
  };
  state.n = n;
  state.x = fit(state.x);
  state.y = fit(state.y);
  const source = systemSource();
  state.keys = setup(n, source);
  state.previous = null;
  state.ciphertext = encrypt(state.keys.mpk, state.x, source);
  invalidate(state);
}

/** Back to the shipped defaults, including the stage-3 and stage-4 key sets. */
export function reset(state: LabState): void {
  state.n = 4;
  state.x = [...DEFAULT_X];
  state.y = [...DEFAULT_Y];
  state.bound = DEFAULT_BOUND;
  const source = systemSource();
  state.keys = setup(4, source);
  state.ciphertext = encrypt(state.keys.mpk, state.x, source);
  state.previous = null;
  state.collected = [];
  state.aloneCollected = [];
  state.overrode = false;
  // `cost` is DELIBERATELY NOT CLEARED. The cost curve is a property of the
  // search algorithm, not of the scenario: it does not depend on x, y, n or
  // even on the bound, and it is measured once by running a real search at
  // each width. Clearing it here left the chart stuck on "MEASURING" forever,
  // because nothing re-measures after boot — caught by the a11y gate, which
  // presses Reset before it reaches the chart.
  invalidate(state);
}

/** The plain integer inner product of the current vectors, over Z. */
export function currentAnswer(state: LabState): bigint {
  let acc = 0n;
  for (let i = 0; i < state.n; i++) acc += state.x[i] * state.y[i];
  return acc;
}

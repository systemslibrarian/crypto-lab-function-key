/**
 * Two scalar sources, kept apart on purpose.
 *
 * `seededSource` is deterministic and is what the pinned fixtures use, so a
 * fixture's s and r are reproducible and a test result means the same thing on
 * every machine. `systemSource` draws from the platform CSPRNG and is what the
 * live UI uses.
 *
 * They are separate functions rather than one function with a flag because the
 * failure mode of getting that flag wrong is a lab that looks random and is
 * not. Nothing in this lab is production key material either way — everything
 * is per-session and in memory — but a demo that silently seeded its live keys
 * from a constant would be teaching something false about Setup.
 */

import { sha512 } from '@noble/hashes/sha2.js';
import { GROUP_ORDER } from './ristretto';
import type { ScalarSource } from './ipfe';

function bytesToBigInt(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc;
}

/**
 * Deterministic scalars from a label, by SHA-512 in counter mode.
 *
 * Each scalar is reduced from 64 hash bytes (512 bits) into [0, l) where l is
 * just over 2^252. Reducing a 512-bit value mod a 252-bit modulus leaves a bias
 * below 2^-260, which is the standard wide-reduction construction and is far
 * beyond anything this lab could exhibit. It is stated because "reduce a hash
 * mod the order" is also how it is done badly when the hash is too narrow.
 */
export function seededSource(label: string): ScalarSource {
  const seed = new TextEncoder().encode(label);
  let counter = 0;
  return {
    nextScalar(): bigint {
      const block = new Uint8Array(seed.length + 4);
      block.set(seed, 0);
      const c = counter++;
      block[seed.length] = (c >>> 24) & 0xff;
      block[seed.length + 1] = (c >>> 16) & 0xff;
      block[seed.length + 2] = (c >>> 8) & 0xff;
      block[seed.length + 3] = c & 0xff;
      return bytesToBigInt(sha512(block)) % GROUP_ORDER;
    },
  };
}

/** Scalars from the platform CSPRNG, for live use in the page. */
export function systemSource(): ScalarSource {
  return {
    nextScalar(): bigint {
      const bytes = new Uint8Array(64);
      crypto.getRandomValues(bytes);
      return bytesToBigInt(bytes) % GROUP_ORDER;
    },
  };
}

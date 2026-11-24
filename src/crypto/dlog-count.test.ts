import { describe, expect, it, vi } from 'vitest';

// Count the actual group API calls instead of deriving an expectation from
// worstCaseOps: that formula and the search once omitted the same two calls.
const calls = vi.hoisted(() => ({ count: 0 }));
vi.mock('./ristretto', async (importOriginal) => {
  const group = await importOriginal<typeof import('./ristretto')>();
  return {
    ...group,
    add: (...args: Parameters<typeof group.add>) => {
      calls.count++;
      return group.add(...args);
    },
    negate: (...args: Parameters<typeof group.negate>) => {
      calls.count++;
      return group.negate(...args);
    },
    scalarMulBase: (...args: Parameters<typeof group.scalarMulBase>) => {
      calls.count++;
      return group.scalarMulBase(...args);
    },
  };
});

import { dlogSymmetric } from './dlog';
import { scalarMulBase } from './ristretto';

describe('the reported total counts every high-level group call', () => {
  it('includes the shift addition and stride negation for both hits and misses', () => {
    for (const bound of [0n, 1n, 8n, 25n, 1024n]) {
      for (const exponent of [-bound - 1n, -bound, 0n, bound, bound + 1n]) {
        const target = scalarMulBase(exponent);
        calls.count = 0;
        const result = dlogSymmetric(target, bound);
        expect(result.ops.total).toBe(calls.count);
      }
    }
  });
});

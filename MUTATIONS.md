# Mutation log (§4.1c)

A green suite is not evidence until you have watched it fail. Every rendered verdict on this page
has a source mutation below that turns it red. For each one, all five conditions from the template's
§4.1c were checked:

1. the mutation is in the **source**, not the test;
2. the **build still succeeds** (`tsc --noEmit && vite build`) — a mutation that breaks `tsc` proves
   nothing, because the suite then runs against the last good bundle and passes;
3. the **bundle hash changes**, proving the mutation reached the browser;
4. the **owning test fails**, naming the finding;
5. the source is **restored** and the hash returns to its pre-mutation value.

The real work was committed **before** any mutation was applied. Mutations were applied one at a
time and restored immediately, in a harness kept **outside** the repo — nothing was staged or
committed while a mutation was in the tree, and the tree was verified clean afterwards.

The hash check covers **every emitted asset** — both JS chunks (the page and the dlog worker) and
the CSS — not just the entry chunk. Hashing only the entry would silently not apply to a third of
the source.

## Results — 17 mutations, 17 bite

| # | Mutation | File | Verdict(s) turned red | Build | Hash | Test |
|---|---|---|---|---|---|---|
| M1 | drop `ct₀` from decrypt (`subtract(numerator, IDENTITY)`) | `crypto/ipfe.ts` | `correctness`, `decrypt-exact` | ok | moved | FAILED |
| M2 | asymmetric BSGS range — shift by `0` instead of `B` | `crypto/dlog.ts` | `range-edge`, `edge-0..3` | ok | moved | FAILED |
| M3 | linear table size — `tableSize = width` | `crypto/dlog.ts` | `cost-law` | ok | moved | FAILED |
| M4 | claim `x` pinned regardless of rank | `crypto/attacks.ts` | `partial`, `two-candidates` | ok | moved | FAILED |
| M5 | float elimination — `fDiv` through doubles, unreduced | `crypto/linalg.ts` | `reconstruct` | ok | moved | FAILED |
| M6 | skip the mod-ℓ reduction in KeyDer | `crypto/ipfe.ts` | `scalar-canonical` | ok | moved | FAILED |
| M7 | claim rank `n` on a rank-deficient key set | `crypto/linalg.ts` | `rank-refusal` | ok | moved | FAILED |
| M8 | reuse `r` across encryptions | `crypto/ipfe.ts` | `randomized`, `component-*` | ok | moved | FAILED |
| M9 | force the fixture comparison always-true | `ui/stages.ts` | `fixture-*`, `wrong-fixture-detected` | ok | moved | FAILED |
| M10 | §4.1d assertion 2 — break a check inside the negative-claim fixture | `ui/stages.ts` | `maul-correct`, `negative-claim-verdict` | ok | moved | FAILED |
| M11 | §4.1d assertion 3 — delete the negative-claim text | `ui/stages.ts` | negative-claim text assertion | ok | moved | FAILED |
| M12 | degrade `--control-border` to the decorative `--border` value | `styles.css` | the a11y gate's WCAG 1.4.11 oracle | ok | CSS moved | FAILED |
| M13 | stage 1's authority column echoes the input instead of decrypting | `ui/stages.ts` | `authority-recovery` | ok | moved | FAILED |
| M14 | candidates fixed in advance instead of derived from the null space | `crypto/attacks.ts` | `cand-a`, `cand-b`, `two-candidates` | ok | moved | FAILED |
| M15 | render the integer before the search is run | `ui/stages.ts` | `search-staged` | ok | moved | FAILED |
| M16 | skew the closed form so it disagrees with the measured runs | `crypto/dlog.ts` | `cost-measured-agrees` | ok | moved | FAILED |
| M17 | the issuance policy gate never blocks | `ui/stages.ts` | `policy-gate` | ok | moved | FAILED |

M13 through M17 exist because of the rebuild: each one reintroduces a defect that review found, so
the fix for it is guarded rather than merely applied.

All seventeen restored cleanly; `git status` clean afterwards.

## The one that mattered: M13 was a MISS first, and the fix was not in the test

M13 reintroduces the real defect: stage 1's authority column rendering `state.x` — the value the
reader typed — instead of the result of `n` basis-key decryptions. The first run reported
**`MISS (test stayed green)`**, with the build succeeding and the hash moving. The test that was
supposed to own that claim could not see the defect at all.

The reason is worth stating plainly, because it is a trap that would catch any similar test:

> **"Decrypted correctly" and "echoed the input" render exactly the same characters.** When the
> decryption works, its output *is* the input. No assertion about the displayed value — however
> many surfaces it cross-checks — can separate them.

Adding a per-coordinate table and asserting it against the headline did not help either: both are
built from the same correct decryptions, so both stay correct under the mutation.

What separated them was changing the **source**, not the test. The authority's `n` searches were
running under a private bound of `ENTRY_MAX`, chosen because a coordinate is a single entry and can
never exceed it. That made the column *incapable of failing* — and a column that cannot fail is one
whose value could equally well have been copied from the input field. The searches now run under
the same bound `B` as everything else, so dropping `B` below an entry makes the authority's own
searches refuse. The test drives exactly that state:

```
await setVec(page, 'x', 0, '9');
await page.locator('#bound-slider').fill('3');   // B = 8, below the entry 9
await expect(page.locator('[data-field="authority-vector"]')).toContainText('fell outside the range');
expect(await verdictTone(page, 'authority-recovery')).toBe('fail');
```

An implementation reading the input field prints `9` there. M13 then bites.

That change is also the better lab. There is **one** bottleneck in this scheme, not a privileged
path for the authority and a limited one for everyone else, and the page now says so by behaving
that way.

## Other notes worth keeping

**Four mutations broke `tsc` on the first attempt and had to be rewritten, because a broken build
proves nothing.** `return numerator` left `subtract` unused; `const r = 7n` left `rng` unused;
`state.x.map(...)` left `coords` unused; and M14's replacement callback left its `f` parameter
unused (`noUnusedParameters`). Each reported "build BROKE / test green", which is indistinguishable
from a passing gate if you only read the test column. All four were rewritten to be type-correct
with the same semantics — `subtract(numerator, IDENTITY)`, `toScalar(7n + 0n * rng.nextScalar())`,
`coords.map((_c, i) => state.x[i])`, `f.num * 0n + 1n` — and all four then bit.

**M12 moves the CSS hash and not the JS hash, which is correct rather than a miss.** The mutation is
in `styles.css` and Vite emits CSS as its own asset.

**What M12 proved about the gate.** It failed naming **28 separate WCAG 1.4.11 findings** in the
arrival state alone, each with its measured ratio and the requirement:

```
new or worsened non-text contrast in state: dark / arrival: stage 1 computed, four stages unrendered
  NEW 1.77:1 (needs 3:1) [control-boundary] button#tab-decode.tab-btn
      — border-top 1.77:1 vs surround — best delineator of a control that has a fill and a border
  NEW 1.65:1 (needs 3:1) [control-boundary] input — border-top 1.65:1 vs surround
  NEW 1.65:1 (needs 3:1) [control-boundary] button#btn-regen.btn — border-top 1.65:1 vs surround
```

That is the measurement justifying two border tokens rather than one: `--border` sits at 1.65–1.77:1
against the surfaces it is drawn on, which is right for a decorative separator and fails as a
control edge. `--control-border` was chosen arithmetically at 4.09:1 worst case.

**M5 would have been a false pass as first designed.** "Float elimination" implemented as rounding
through `Number` at a large scale does *not* change the output on this lab's fixtures: the stage-3
matrix has only 0/±1/2 entries, so every pivot is a power of two, every intermediate is exactly
representable in binary floating point, and the round trip returns the same integers. The mutation
was redesigned to be faithful to what a float implementation actually costs — losing the exact
*rational* form — by returning an object literal that bypasses `frac()`'s gcd reduction. The
recovered coordinates then render as `2000000/1000000` and the exactness check fails.

The honest reading of that: **exactness is not load-bearing for the stage-3 fixture's own
arithmetic** — it is load-bearing for the rank test and for any fixture with a non-dyadic pivot.
That is why `linalg.test.ts` carries explicit non-dyadic cases (`1/3 + 1/3 + 1/3` exactly 1, `7/2`
rendered as a fraction, a 10⁴⁰ numerator round-tripped) that a float implementation would fail.

## How to re-run

The harness is not committed, by design — the discipline note records a background harness holding a
file mid-mutation during a `git add`, and a mutation shipped. To repeat this, apply one `from → to`
pair from the table by hand, then:

```bash
npm run build                               # MUST succeed; if tsc fails, the mutation proves nothing
md5 dist/assets/*.js dist/assets/*.css      # MUST differ from the pre-mutation values
CI=1 npx playwright test --project=claims -g "<the owning test>"   # MUST fail
# restore the one line, rebuild, confirm the hashes return
```

`CI=1` matters: without it `reuseExistingServer` reuses a preview server already holding the port
and the build in front of it never runs, so the suite would test a stale bundle.

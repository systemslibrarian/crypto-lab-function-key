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

The real work was committed **before** any mutation was applied (`ed3ac8e`). Mutations were applied
one at a time and restored immediately, in a harness kept **outside** the repo — nothing was staged
or committed while a mutation was in the tree. The tree was verified clean afterwards.

Baseline bundle: `dist/assets/index-Cy7qjRpG.js` md5 `5bdeca57de947b1b8868db31c969800f`;
`dist/assets/index-*.css` md5 `3ac94411b9fda567d26b47eab15d7c91`.

## Results — 12 mutations, 12 bite

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
| M9 | force the fixture comparison always-true | `ui/panels.ts` | `fixture-*`, `wrong-fixture-detected` | ok | moved | FAILED |
| M10 | §4.1d assertion 2 — break a check inside the negative-claim fixture | `ui/panels.ts` | `maul-correct`, `negative-claim-verdict` | ok | moved | FAILED |
| M11 | §4.1d assertion 3 — delete the negative-claim text | `ui/panels.ts` | negative-claim text assertion | ok | moved | FAILED |
| M12 | degrade `--control-border` to the decorative `--border` value | `styles.css` | the a11y gate's WCAG 1.4.11 oracle | ok | CSS moved | FAILED |

All twelve restored cleanly; `git status` clean afterwards.

## Notes worth keeping

**Two mutations had to be rewritten because the first attempt broke `tsc`, and a broken build
proves nothing.** M1 as `return numerator` left `subtract` unused (`TS6133`); it became
`subtract(numerator, IDENTITY)`, which is the same semantics — `ct₀` dropped — while keeping the
import used. M8 as `const r = 7n` left the `rng` parameter unused; it became
`toScalar(7n + 0n * rng.nextScalar())`, which still pins `r` to 7 on every call. Both then bit.
This is exactly the trap §4.1c warns about: the first run of each reported "build BROKE / test
green", which is indistinguishable from a passing gate if you only read the test result.

**M12 moved the CSS bundle hash and not the JS one, which is correct rather than a miss.** The
mutation is in `styles.css`, and Vite emits CSS as its own asset; requiring the JS hash to move
for a CSS mutation would be checking the wrong artifact. The first harness run flagged it as
"NO HASH CHANGE" for that reason and it was re-run CSS-aware.

**What M12 proved about the gate, specifically.** It failed naming every affected control, its
measured ratio and the requirement:

```
new or worsened non-text contrast in state: dark / arrival: exhibit 1 computed, seven panels unrendered
  NEW 1.77:1 (needs 3:1) [control-boundary] button#tab-decrypt.tab-btn
      — border-top 1.77:1 vs surround — best delineator of a control that has a fill and a border
  NEW 1.65:1 (needs 3:1) [control-boundary] input — border-top 1.65:1 vs surround
  NEW 1.65:1 (needs 3:1) [control-boundary] button#btn-regen.btn — border-top 1.65:1 vs surround
  ... (17 controls in the arrival state alone)
```

That is also the measurement that justifies this lab carrying **two** border tokens instead of one:
`--border` measures 1.65–1.77:1 against the surfaces it sits on, which is correct for a decorative
separator and would fail WCAG 1.4.11 as a control edge. `--control-border` was chosen
arithmetically at 4.09:1 worst case. Collapsing them is a real regression, and the gate catches it
in the arrival state before any drive.

**M5 is the one that needed thought, and the first design of it would have been a false pass.**
"Float elimination" implemented as rounding through `Number` at a large scale does *not* change the
output on this lab's fixtures: the act-4 matrix has only 0/±1/2 entries, so every pivot is a power
of two, every intermediate is exactly representable in binary floating point, and the round trip
returns the same integers. A mutation that leaves the suite green proves nothing about the tests, so
the mutation was redesigned to be faithful to what a float implementation actually costs — losing
the exact *rational* form — by returning an object literal that bypasses `frac()`'s gcd reduction.
The recovered coordinates then render as `2000000/1000000` rather than `2`, the `den === 1n`
exactness check fails, and the verdict goes red.

The honest reading of that first attempt: **exactness is not load-bearing for the act-4 fixture's
own arithmetic** — it is load-bearing for the rank test and for any fixture with a non-dyadic pivot.
The claim the page makes is still true and still checked (`den === 1n` on every coordinate); what
the fixture does not do is exercise floating-point error. That is recorded here rather than papered
over, and it is the reason `linalg.test.ts` carries explicit non-dyadic cases (`1/3 + 1/3 + 1/3`
exactly 1, `7/2` rendered as a fraction, a 10⁴⁰ numerator round-tripped) that a float
implementation would fail.

## How to re-run

The harness is not committed, by design — the discipline note records a background harness holding a
file mid-mutation during a `git add`, and a mutation shipped. To repeat this, apply one `from → to`
pair from the table above by hand, then:

```bash
npm run build                    # MUST succeed; if tsc fails, the mutation proves nothing
md5 dist/assets/*.js dist/assets/*.css   # MUST differ from the baseline above
CI=1 npx playwright test --project=claims -g "<the owning test>"   # MUST fail
# restore the one line, rebuild, confirm the hash returns
```

`CI=1` matters: without it `reuseExistingServer` reuses a preview server already holding the port
and the build in front of it never runs, so the suite would test a stale bundle.

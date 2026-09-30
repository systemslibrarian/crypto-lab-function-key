# Function Key

**Inner-product functional encryption · DDH (ABDP15) · ristretto255**

Ordinary decryption releases the message. A functional key releases only `<x, y>` — until
enough keys add up to the whole message.

## What It Is

An interactive, browser-only lab for **inner-product functional encryption (IPFE)** built on the
scheme from Abdalla, Bourse, De Caro and Pointcheval, *Simple Functional Encryption Schemes for
Inner Products* (PKC 2015; [ePrint 2015/017](https://eprint.iacr.org/2015/017)), **Construction
3.1** — the DDH-based construction, implemented here over **ristretto255**
([RFC 9496](https://www.rfc-editor.org/rfc/rfc9496.html)).

Functional encryption adds a middle setting between "you hold the key and see everything" and
"you don't and see nothing": the authority can issue a key that answers exactly one question
about the encrypted data. Here that question is a weighted sum. Encrypt a vector `x`; a key for
the weight vector `y` returns the single integer `<x, y>` and nothing else about `x`.

The primitives, all real and all implemented in this repo:

- **Setup / KeyDer / Encrypt / Decrypt** — ABDP15 Construction 3.1 verbatim in structure.
  `s ← Z_ℓⁿ`; `mpk = (h_i = g^{s_i})`; `sk_y = <s, y> mod ℓ`; `ct₀ = g^r`, `ct_i = h_i^r · g^{x_i}`;
  decryption is `∏ ct_i^{y_i} / ct₀^{sk_y} = g^{<x,y>}` followed by a discrete log.
- **Baby-step giant-step** over a *symmetric* range `[−B, B]`, with an exact group-operation
  counter. This is what makes the scheme's honest limitation measurable rather than described.
- **Exact linear algebra** — BigInt rationals over ℚ for reconstructing `x`, and elimination
  mod ℓ for recovering the master secret. No floating point anywhere.

**Security model:** ABDP15 Theorem 3.2 proves the scheme **selectively** IND-FE-CPA secure under
DDH. That is *selective*, not adaptive (adaptive security needs ALS16, which is not built here),
and **CPA only** — the ciphertext is additively malleable, which this lab demonstrates rather
than mentions.

**One packaging note, stated rather than implied:** the paper's `mpk` is `(h_i)` alone, with `g`
arriving in the public parameters from `GroupGen`. This lab carries `g` inside its
`MasterPublicKey` for convenience. That is a packaging choice, not a deviation, and the paper
does not write it that way.

**Not production cryptography.** This is a teaching demo. Key material is per-session and in
memory; nothing is persisted and there is no backend.

## Exhibits

1. **Two kinds of key** — the same ciphertext opened two ways: an ordinary decryption that hands
   back the whole vector, and a functional key for `y` that hands back one number. Edit either
   vector and both sides update.
2. **Decrypt** — the step that surprises people. Applying the functional key succeeds
   *immediately* and yields a group element; that element **is** the answer, encoded as
   `g^{<x,y>}`. Recovering the integer is a separate search. The panel shows the ciphertext
   components changing completely under a fresh `r` while the decrypted element does not — which
   is the correctness identity (the `r` terms cancel) made visible.
3. **The bottleneck** — a slider for the bound `B`, a live operation count, and a log-log chart of
   measured worst-case group operations against search width with the reference curve `2√W` drawn
   over it. Plus a boundary table showing the search succeeding at exactly `±B` and refusing at
   `±(B+1)`, in **both** directions.
4. **Collect keys** — the analyst requests functional keys one at a time against one fixed
   ciphertext. After each, the panel shows the exact affine set of `x` still consistent with every
   answer, its dimension shrinking. Two deliberately chosen distinct vectors are displayed side by
   side, both consistent, until full rank collapses the set to one point.
5. **Keys alone** — no ciphertext at all. Since `sk_y = <s, y> mod ℓ`, each key is one linear
   equation in `s`; `n` independent ones are a square system over a prime field. Solve it, derive
   a key for a weight vector the authority **never issued**, and decrypt a freshly created
   ciphertext with it correctly. A rank-deficient key set is refused with its rank shown.
6. **Fixtures** — seeded, reproducible rows through the real scheme, printing both the computed
   and the claimed value on every row. **One row is wrong on purpose** and must be reported as
   disagreeing; see *What Can Go Wrong*.
7. **Where IPFE sits** — ABE controls *whether* the plaintext is released; IPFE controls *which
   function* of it is released; FHE lets a server compute *without learning* the plaintext. The
   panel is careful about the ABE comparison: collusion resistance in FAME CP-ABE and linear
   reconstruction here are different phenomena, not the same one graded differently.
8. **Honesty** — real / modeled / not implemented, the threat model, the negative claim with its
   evidence fixture, and the primary sources.

## When to Use It

**Use it to:**

- Understand what "a key for a function" actually buys, by running one.
- See why DDH-based IPFE is restricted to *small* outputs — and what that restriction costs, in
  group operations, on a curve.
- Understand the difference between a scheme being broken and a scheme being **over-authorized**.
  This is the lab's central point and the one most often gotten wrong.
- Reason about key-issuance policy: the authority decides, one key at a time, how much of the
  plaintext it has already given away.

**Do NOT use it to:**

- **Protect anything.** Not production crypto. No CCA security, no integrity, no key management,
  no constant-time guarantees.
- **Conclude that IPFE is insecure.** Full reconstruction from `n` independent keys is the
  functionality delivering what was authorized. ABDP15 still holds; see below.
- **Estimate real-world performance.** The parameter caps here (`n ≤ 8`, entries in `[−9, 9]`,
  `B ≤ 2²¹`) exist to keep an in-browser discrete log interactive.

## Live Demo

**<https://systemslibrarian.github.io/crypto-lab-function-key/>**

Edit `x` and `y` and watch the single released number track the weighted sum. Drag the bound
slider and watch the cost curve follow `√W` rather than `W`. Lower the bound under the current
answer and watch the search refuse rather than return something wrong. Then collect functional
keys one at a time in exhibits 4 and 5 and watch what "only one question" adds up to.

## What Can Go Wrong

**The two honest limits of the construction**, both executable on the page:

1. **The discrete-log bottleneck.** Decryption yields `g^{<x,y>}`; recovering the integer is a
   discrete log, tractable only because the answer is known to be small. Push the answer outside
   the bound and the search **reports failure** — it never returns a wrapped value. ALS16 removes
   this restriction using **Paillier** specifically; its LWE schemes keep short coordinates and
   add inner products modulo a prime instead. Neither is built here.

2. **The functionality itself leaks.** `n` linearly independent outputs *are* `x`. And since
   `sk_y = <s, y>`, `n` independent keys *are* the master secret `s`, with no ciphertext involved.

   **Neither breaks the scheme, and the reason is precise.** ABDP15's security game constrains key
   queries to vectors `y` with `<x₀, y> = <x₁, y>`. If `n` independent such queries are allowed,
   then `x₁ − x₀` is orthogonal to a basis, so `x₀ = x₁` — there is no pair of distinct messages
   left to distinguish, and the game is vacuous at that point rather than lost. The limit is in
   **what was authorized**, not in the proof. What this does *not* say: it is not an argument that
   ABDP15 is adaptively secure (it is not proven to be), and not an argument that collusion is
   harmless in a deployment — an authority that issues `n` independent keys has given away `s`,
   which is a key-management fact no proof can help with.

**The negative claim**, with a reachable state in which every check the page performs reports
success and the property is violated anyway:

> **ABDP15 ciphertexts are additively malleable: this scheme gives no integrity, so anyone can
> turn a ciphertext of `x` into a valid ciphertext of `x + x′` without any key, and decryption
> cannot tell.**

Multiply two ciphertexts componentwise — no key required — and the product is a well-formed
encryption of the sum under randomness `r + r′`. Decryption succeeds, the answer is
arithmetically correct, and no check fails, because **there is no integrity check here to fail.**
The absence of a failure code is the exhibit. ABDP15 claims CPA security and nothing more;
inventing an error code to look thorough would teach the opposite of the lesson.

**A subtler one, worth knowing:** with *exactly* `n` independent keys the system is square and
invertible, so **every** output vector is consistent with exactly one `x`. A corrupted output
therefore moves the recovered `x` silently rather than producing a contradiction — and in the
lab's own fixture the wrong answer is still integral, so integrality is not a reliable tell.
Detecting corruption needs redundancy: more than `n` observations. Both cases are pinned in
`src/crypto/attacks.test.ts`.

**And one about the tests themselves.** Exhibit 6 ships a fixture that is **wrong on purpose** —
it claims 16 where its own `x` and `y` give 15 — rendered as a row like any other and asserted to
be reported as failing. A table that has only ever been seen agreeing is not evidence: if every
row passed, a change forcing the comparison always-true would look identical from the page. Do
not "fix" that row.

## Real-World Usage

IPFE is the practical corner of functional encryption — general-function FE needs indistinguishability
obfuscation and is not deployable. Inner products alone cover a lot of what data-sharing requests
actually ask for: weighted averages, subtotals, scores, linear regression coefficients, descriptive
statistics over records you are not permitted to read. ABDP15 names descriptive statistics as the
motivating case.

The FENTEC project's [GoFE](https://github.com/fentec-project/gofe) and
[CiFEr](https://github.com/fentec-project/CiFEr) libraries implement this scheme and its relatives
for real use. Where you see IPFE in production-adjacent settings it is generally as a building
block for privacy-preserving analytics or as the linear layer under a larger protocol, and the
small-output restriction is handled by choosing a Paillier- or LWE-based variant rather than by
searching harder.

The lesson that transfers regardless of scheme is the key-issuance one. Functional encryption
moves the security question from "who can decrypt" to "which functions have I already authorized,
and what do they span". That is a question about linear algebra over your issued keys, and it has
an exact answer — which exhibits 4 and 5 compute.

## How to Run Locally

```bash
npm install
npm run dev          # serve with hot reload
```

Then:

```bash
npm test             # unit tests + KATs (Vitest)
npm run build        # tsc --noEmit && vite build
npm run test:a11y    # axe WCAG 2.1 A/AA gate against the production build
npm run test:claims  # the claims suite -- does the page tell the truth
npm run test:e2e     # functional flows, desktop + mobile viewport
npm run test:e2e:all # everything Playwright runs
```

The Playwright suites build first and then serve `dist/` on **port 4683** — a port checked against
every sibling lab in the fleet and against the catalog's own port registry. `vite preview` only
serves what is already in `dist/`, so the build is in front of the server deliberately: without it
a failing build leaves the previous good bundle in place and the whole suite passes green against
source that no longer compiles.

## Related Demos

- [ElGamal Plain](https://systemslibrarian.github.io/crypto-lab-elgamal-plain/) — the DDH-based
  encryption this construction sits on. Start here if `g^{ab}` vs random is new.
- [Curve Lens](https://systemslibrarian.github.io/crypto-lab-curve-lens/) — elliptic-curve group
  structure, by eye.
- [Attribute Gate](https://systemslibrarian.github.io/crypto-lab-attribute-gate/) — FAME CP-ABE
  over BLS12-381. Controls *whether* the plaintext is released, and leads on collusion resistance.
  The nearest neighbour to this lab and the sharpest contrast with it.
- [FHE Arena](https://systemslibrarian.github.io/crypto-lab-fhe-arena/) and
  [CKKS Lab](https://systemslibrarian.github.io/crypto-lab-ckks-lab/) — computing without learning
  the plaintext, the opposite direction from FE.
- [Paillier Gate](https://systemslibrarian.github.io/crypto-lab-paillier-gate/) — the cryptosystem
  ALS16 uses to remove this lab's small-output restriction.

## Build & Verify

**Gates are run before any lab code is written on top of a dependency**, and both are pinned as
tests so they keep holding.

**Gate 1 — the group library.** `@noble/curves` 2.4.0 is checked against
**[RFC 9496](https://www.rfc-editor.org/rfc/rfc9496.html) Appendix A**, fetched from the RFC
Editor (SHA-256 of the retrieved text `d875c6e703827da487eae8f0656fd25e4a278f1dcb0f06041669adad27c03ff3`)
and transcribed verbatim into `src/crypto/rfc9496-vectors.ts`:

| Appendix | What | Count | Result |
|---|---|---|---|
| A.1 | multiples of the generator, encode **and** decode directions | 16 | all reproduce |
| A.2 | encodings that MUST be rejected | 29 | all rejected; all 16 valid ones still accepted |
| A.3 | the Section 4.3.4 one-way map (`deriveToCurve`, **not** RFC 9380 `hashToCurve`) | 8 | all reproduce |

The 16 A.1 encodings were additionally corroborated against the independently pinned copy in
`crypto-lab-dkg-gate`. There are **no standardized IPFE test vectors**, so nothing in this repo is
labelled as one; the group layer is where a published vector exists, and that is where it is
pinned. FENTEC's GoFE/CiFEr were considered as a cross-check for the scheme layer and **skipped**:
they work over a different group, so matching their outputs would mean re-deriving them here,
which proves nothing.

**Gate 2 — the scheme.** Read from ABDP15 Construction 3.1 directly (ePrint 2015/017, SHA-256
`353f454857a5ef421ab7b17545b9657f5d192dc0a37f022cca7b71e916f84712`) rather than from memory, and
implemented to match its structure.

**The library chokepoint.** `src/crypto/ristretto.ts` is the only module that imports
`@noble/curves`, and it earns that with a **measured precondition** rather than a comment: the
library's `multiply()` throws on `0`, on negatives, and at or above the group order — all three of
which this lab produces on its ordinary path, since `y = 0` is an explicit edge case and vector
entries are signed. The chokepoint returns the identity and the correct inverse instead, and
`ristretto.test.ts` asserts *both halves*: the raw call throwing, **and** the chokepoint's answer
pinned to an A.1 encoding or reached by negation.

**Test counts:**

| Suite | Tests | Covers |
|---|---|---|
| `npm test` (Vitest) | **176** | RFC 9496 A.1/A.2/A.3 KATs, ABDP15 correctness, BSGS boundaries and cost law, exact rational and mod-ℓ algebra, reconstruction, master-secret recovery, rank refusal |
| `e2e/claims.spec.ts` | **22** | invariants 1–9 rendered on the page, by independent re-derivation; §4.1d negative claim; `[hidden]` probe; retirement and no-op guards; cross-checks between surfaces |
| `e2e/a11y.spec.ts` | **2** | the axe WCAG 2.1 A/AA gate across ~30 driven states, at desktop and 380px |
| `e2e/flows.spec.ts` | **14 × 2** | one functional scenario per exhibit, at desktop and on a mobile viewport |

**KAT files:** `src/crypto/rfc9496-vectors.ts` (the published vectors),
`src/crypto/ristretto.test.ts` (the gate that drives them), `src/crypto/fixtures.ts` (the lab's own
seeded fixtures, including the deliberately wrong row).

**The accessibility gate** (`@axe-core/playwright`, WCAG 2.1 A/AA) scans the **production build**
across roughly thirty driven states — every exhibit, every rank in exhibits 4 and 5, the
out-of-range branch, the failing fixture row, hover and focus states — at desktop and at 380px, and
blocks the Pages deploy if any of it regresses. It is more than `violations`: it asserts axe's
`incomplete` bucket too, computes contrast arithmetically over composited backdrops (including the
chart's SVG text), and carries a ratcheted WCAG 1.4.11 non-text-contrast oracle whose baseline is
**empty**. Reduced motion is emulated before navigation and asserted in-page rather than injected,
so the lab's own `prefers-reduced-motion` block is exercised instead of bypassed.

**Two accessibility defects found and fixed during the build**, both in CSS the fleet template
prints and both WCAG 1.4.10 (Reflow) failures at 380px: the standard hero gives `.cl-hero-why` a
mobile full-width rule but gives `.cl-hero-main` none, and the standard hero's padded full-width
box assumes a `box-sizing: border-box` reset the template does not itself print. Both are fixed
here at the source — the second at the reset, so it cannot recur — and both are documented in
`src/styles.css` with the measurements. Neither is a local invention: siblings across the fleet
already carry the first fix, and `crypto-lab-schnorr-forge` (the gate reference lab) already
carries the second.

**Mutation-tested (§4.1c).** Each rendered verdict has a source mutation that turns it red with the
build still succeeding and the bundle hash moving. See `MUTATIONS.md` for the log.

### On `--accent`, the favicon, and the catalog category

This repo deliberately **does not** set `--accent` on `:root`, declare a favicon, or assert a
catalog category. All three are assigned centrally so they can be judged against the rest of the
catalog — the accent against the four-colour rotation and the 4-, 2- and 1-column card layouts, and
the favicon emoji against a fleet where the obvious choice for this lab (a key) is already used by
four other labs.

The page is built to accept the assignment with no further edit: every accent surface reads
`var(--accent, #35d6bb)` through one `--accent-live` token, so defining `--accent` on `:root`
re-tints the whole page, and the fleet top bar already falls back to the same teal. The a11y gate
asserts `--accent` is undefined, so it is on the record that the measured contrast is the
fallback's; if the assigned colour is a dark hue, `.btn-primary` and the selected tab are the two
controls to re-measure, and the fix is to give them an explicit `--control-border` edge.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*

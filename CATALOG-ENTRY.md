# Catalog data for `crypto-lab-function-key`

Paste-ready. **Nothing in `systemslibrarian/crypto-lab` was edited** — this file hands the data
back instead, per the build instructions.

Pinned at commit **`9b256abb0b1270fb4bd1a5cabd573258cf5bd4b7`**.

That is the last commit containing lab code, tests or configuration, and it is the state that was
deployed and verified live (the served bundle was confirmed byte-identical to a local build of it).
Commits after it on `main` add only this file and notes about it, so the review sha deliberately
does not chase its own documentation — pinning to the tip would move every time this file is
edited. `9b256ab` is reachable on `main`; verify with `git log 9b256ab..main --oneline` that
nothing but documentation follows it.

**Three fields are deliberately left for central assignment and are NOT proposed here:**
`--accent`, the favicon emoji, and the final `data-category`. The neighbour data needed to decide
the first two is in the last section.

---

## 1. Catalog card

Kicker / title / copy / chips, in the shape `index.html` uses:

```html
<a class="project-card" data-category="ENCRYPTION" href="https://systemslibrarian.github.io/crypto-lab-function-key/"
  data-implements="ristretto255@src/crypto/ristretto.ts:43 | SHA-512@src/crypto/prng.ts:47 | ABDP15 IPFE@src/crypto/ipfe.ts:74 | Baby-step giant-step@src/crypto/dlog.ts:130 | Discrete logarithm@src/crypto/dlog.ts:130"
  data-references="Diffie-Hellman | ElGamal | FAME CP-ABE | Paillier | LWE"
  data-attacks="Key collusion / linear reconstruction@src/crypto/attacks.ts:232 | Ciphertext malleability@src/crypto/ipfe.ts:221"
  data-standards="IETF"
  data-implementation="@noble"
  data-review-commit="9b256abb0b1270fb4bd1a5cabd573258cf5bd4b7"
  data-review-note="Browser TypeScript throughout; @noble/curves pinned to RFC 9496 Appendix A (A.1/A.2/A.3) before any scheme code, ABDP15 Construction 3.1 implemented in-repo"
  target="_blank" rel="noopener" style="--accent: /* ASSIGNED CENTRALLY */;">
  <div class="card-kicker">Functional Encryption</div>
  <div class="project-title">Function Key</div>
  <div class="project-copy">Issue a key that answers one question about an encrypted vector — its weighted sum — and nothing else. Watch decryption finish without producing a number, then issue keys one at a time and watch the set of possible plaintexts shrink, until you are the authority deciding whether to sign the one that hands over the master secret.</div>
  <div class="project-meta">
    <div class="stack">
      <span class="chip">ABDP15 IPFE</span>
      <span class="chip">ristretto255</span>
      <span class="chip">Baby-Step Giant-Step</span>
      <span class="chip">Key Collusion</span>
    </div>
    <span class="arrow">→</span>
  </div>
</a>
```

**Plain fields, if you prefer them separately:**

| Field | Value |
|---|---|
| Card title | `Function Key` |
| Kicker | `Functional Encryption` |
| Description | Issue a key that answers one question about an encrypted vector — its weighted sum — and nothing else. Watch decryption finish without producing a number, then issue keys one at a time and watch the set of possible plaintexts shrink, until you are the authority deciding whether to sign the one that hands over the master secret. |
| Chips | `ABDP15 IPFE` · `ristretto255` · `Baby-Step Giant-Step` · `Key Collusion` |
| About one-liner (GitHub) | Inner-product functional encryption over ristretto255: a key that releases only ⟨x, y⟩, the discrete-log bound that limits it, and what enough keys add up to. |

**Two vocabulary notes for `tools/catalog-vocab.js`:** `ristretto255` and `SHA-512` are already in
`ALGORITHMS`. **`ABDP15 IPFE` and `Baby-step giant-step` are not** — `catalog-vocab` was checked and
neither matches. They will need adding, or the `data-implements` entries reduced to the two known
names.

## 2. Category suggestion

**Suggested: `ENCRYPTION`.** Reasoning, since the brief asked for ENCRYPTION or PRIVACY
specifically:

- The declared nearest neighbour, `crypto-lab-attribute-gate` (FAME CP-ABE), is `ENCRYPTION`, and so
  is `ibe-gate` — the other "who/what may decrypt" lab. IPFE sits in that family: it is an
  encryption scheme whose contribution is *what the key releases*.
- `PRIVACY` in this catalog clusters around access-pattern and metadata privacy — ORAM, PSI, mix
  nets, DP, PIR (concept §23 Obliviousness). This lab is not that; the analyst learns a statistic
  by design, and nothing here hides access patterns.

`ENCRYPTION | PRIVACY` is defensible on the "release a statistic, not the record" framing, and there
is precedent for the pair (`crypto-lab-shadow-vault` carries it). I am not setting it — flagging the
choice and the reasoning is the deliverable.

## 3. `tools/catalog-reviewed.json` entry

```json
  "crypto-lab-function-key": {
    "commit": "9b256abb0b1270fb4bd1a5cabd573258cf5bd4b7",
    "reviewed": "2026-09-30",
    "add": [
      "ristretto255@src/crypto/ristretto.ts:43",
      "SHA-512@src/crypto/prng.ts:47",
      "ABDP15 IPFE@src/crypto/ipfe.ts:74",
      "Baby-step giant-step@src/crypto/dlog.ts:130"
    ],
    "implementation": "@noble",
    "note": "Browser TypeScript throughout, no other language and no WASM. Group operations are @noble/curves 2.4.0, pinned to RFC 9496 Appendix A (16 A.1 multiples both directions, 29 A.2 rejections, 8 A.3 map outputs) before any scheme code was written on it; ABDP15 Construction 3.1 and the BSGS, exact-rational and mod-l algebra are implemented in-repo"
  }
```

No `covered` key: that field records source review beyond the browser TypeScript (Rust, C, Python),
and this lab has none — everything is TS under `src/`.

## 4. `concept-coverage.md` line

The lab's hardness assumption is DDH, so it files under **§8 Discrete logarithm**, following the
precedent that ABE files under §9 (Pairings) by assumption family rather than by application. §8 is
currently a bare list with no prose, so this adds a paragraph:

```markdown
**8. Discrete logarithm — `COVERED`**
Curve Lens · Point Arithmetic · ElGamal Plain · DH MITM · Curve448 · Ed25519 Forge · Function Key.

Function Key is the one that uses the discrete log as a *cost* rather than as a hardness
assumption. ABDP15's DDH-based inner-product functional encryption decrypts to `g^⟨x,y⟩`, so
recovering the answer means solving a discrete log — tractable only because the answer is small,
and the lab measures what "small" costs in group operations with a symmetric baby-step giant-step
and plots it against `√W`. Its lead is a negative result of a particular kind, and the distinction
is the part worth keeping: `n` independent functional keys reconstruct the plaintext, and `n`
independent keys with **no ciphertext at all** reconstruct the master secret, because `sk_y =
⟨s, y⟩` makes each key one linear equation in `s`. Neither breaks the scheme. ABDP15's game only
constrains key queries with `⟨x₀,y⟩ = ⟨x₁,y⟩`, and `n` independent such queries force `x₀ = x₁`,
so the game goes vacuous rather than lost — the limit is in what was authorized, not in the proof.
Read against Attribute Gate (§9) rather than beside it: ABE controls *whether* the plaintext is
released and resists collusion; IPFE controls *which function* is released, and its keys combine
linearly exactly as authorized.
```

**A taxonomy question for the maintainer, not a decision I should make:** "a key that releases a
function of the plaintext" is arguably its own concept, distinct from both §9's access control and
§22's homomorphic computation, and it currently has no entry. Filing under §8 is the
least-invasive placement and matches the by-assumption precedent. If a new concept is preferred,
§8 and §22 should both cross-reference it. Either way §8 stays `COVERED` and the Gap summary stays
empty.

## 5. Corpus entry draft (`crypto-counsel/corpus.json`)

Matches the live format — `{ id, text }`, with `demo_crypto_lab_<slug_with_underscores>` and a
markdown body. 3.4k characters, against a fleet median of 3.1k.

```json
  {
    "id": "demo_crypto_lab_function_key",
    "text": "Demo Repository: crypto-lab-function-key\nGitHub: https://github.com/systemslibrarian/crypto-lab-function-key\n\n# Function Key\n\n## What It Is\n\nFunction Key is a browser lab teaching inner-product functional encryption, in which a key releases one number computed from an encrypted vector rather than releasing the vector. The scheme is ABDP15 — Simple Functional Encryption Schemes for Inner Products, Abdalla, Bourse, De Caro and Pointcheval, PKC 2015, ePrint 2015/017 — Construction 3.1, the DDH-based construction, running over ristretto255 with Setup, KeyDer, Encrypt and Decrypt written from the paper along with a symmetric baby-step giant-step discrete log, exact BigInt rational elimination and elimination mod the group order, so only the group arithmetic is library code. Encrypt a vector x; a key for a weight vector y returns the single integer inner product of x and y and nothing else about x. That is the middle setting between holding the key and seeing everything and not holding it and seeing nothing, and it is what makes functional encryption more than a filing convention.\n\nThe lab exists for the two honest limits of that construction, both of which it makes you run rather than reading to you. The first is a cost: decryption yields g raised to the inner product, so recovering the integer is a discrete log, tractable only because the answer is known to be small. Lower the bound under the current answer and the search reports failure rather than returning a wrapped value; the operation count is charged exactly and plotted against the square root of the search width, with the cap set by measurement at 2^21 where a worst-case miss still returns inside half a second. ALS16 removes that restriction using Paillier specifically — its LWE schemes keep short coordinates and add inner products modulo a prime instead — and neither is built here.\n\nThe second limit is the stronger teaching moment. The functionality itself leaks: n linearly independent outputs are the plaintext, and because the key for y is the inner product of the master secret with y, n independent keys are the master secret, with no ciphertext involved at all. The lab collects keys one at a time and draws the exact affine set of plaintexts still consistent with every answer received, refusing to draw a single one until the set is a point, then derives a key for a weight vector the authority never issued and decrypts a fresh ciphertext with it correctly. Neither result breaks the scheme, and the lab is careful about why: ABDP15's security game only constrains key queries for vectors y with the same inner product against both challenge messages, and n independent such queries force those messages to be equal, so the game goes vacuous rather than lost. The limit is in what was authorized, not in the proof. What that does not say is also stated: it is not an argument that ABDP15 is adaptively secure, which is not proven, and not an argument that collusion is harmless in a deployment, because an authority that issues n independent keys has given away its master secret.\n\n## When to Use It\n\nReach for this lab when you need to understand what a key for a function actually buys, or when you are reasoning about key-issuance policy and need to see that the question is linear algebra over the keys already issued. It is also the right place to learn the difference between a scheme being broken and a scheme being over-authorized, which is the distinction most often lost when functional encryption is described rather than run. Do not use it to protect anything: there is no CCA security and no integrity of any kind, and the lab demonstrates that too, multiplying two ciphertexts componentwise with no key at all into a valid ciphertext of the sum that decrypts correctly with no failure code raised, because there is no integrity check present to fail. The absence of a code is the exhibit. The parameter caps — dimension at most 8, entries in a small signed range, bound at most 2^21 — exist to keep an in-browser discrete log interactive and are not performance guidance.\n\n## Live Demo\n\nhttps://systemslibrarian.github.io/crypto-lab-function-key/\n\n## Part of the Crypto-Lab Suite\n\nFunction Key is one module in the broader Crypto-Lab collection at https://crypto-lab.systemslibrarian.dev/.\n\nWhether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31"
  }
```

## 6. Accent-check data (for central assignment)

`--accent` is **not set** in this repo. The page is built to take the assignment with no further
edit: every accent surface reads `var(--accent, #35d6bb)` through one `--accent-live` token in
`src/styles.css`, and the fleet top bar already falls back to the same teal. The a11y gate asserts
`--accent` is undefined, so it is on the record that the measured contrast is the fallback's.

**Accent distribution in the candidate categories** (207 cards parsed from `index.html`):

| Category | teal `#35d6bb` | amber `#ffb84d` | rose `#ff6b7f` | violet `#9f88ff` | off-palette |
|---|---|---|---|---|---|
| ENCRYPTION (32) | 10 | 9 | 7 | 5 | 1 (`rsa-educational` `#f59e0b`) |
| PRIVACY (21) | 6 | 7 | 3 | 5 | 0 |
| HOMOMORPHIC (5) | 1 | 1 | 1 | 2 | 0 |

**The adjacency that matters:** the declared nearest neighbour `crypto-lab-attribute-gate` is
**violet `#9f88ff`**, and the comparison panel in exhibit 7 leads on the contrast between the two
labs. Two adjacent cards in the same accent would work against that. Violet is also the least-used
accent in ENCRYPTION, so the usual "pick the rarest" heuristic and the adjacency consideration point
opposite ways here — which is exactly the judgement central assignment exists to make, and why this
repo does not guess.

**One thing to re-measure after assigning**, recorded so it is not discovered later: `.btn-primary`
and the selected `.tab-btn` both paint their border the same colour as their accent fill, so they
have no edge of their own and pass WCAG 1.4.11 on fill-vs-surround. Teal clears it at 10.2:1 against
the page. **A dark accent would not**, and those two controls are the ones that would report first.
The fix then is to give them an explicit `--control-border` edge — not to add them to
`e2e/nontext-baseline.ts`, which is currently empty and should stay that way.

**Open Graph image:** the lab ships its own `og.png` (1200x630), generated from a real render of
the rank-collapse moment by `scripts/make-og.mjs` and committed. It uses the same teal fallback the
rest of the page does, so **if a different accent is assigned, re-run that script** — the palette is
declared at the top of it — and commit the regenerated file.

**Favicon:** not set. The brief holds it back because the obvious glyph for this lab is a key, and
four labs already use that exact emoji (`otp-vault`, `rsa-educational`, `shamir-vs-frost`,
`x3dh-wire`). The `<head>` in `index.html` carries a comment at the point where the `<link
rel="icon">` belongs, so the assignment is a one-line addition.

## 7. Functional-encryption coverage sweep (run, as the brief required)

Swept the catalog (`index.html`, `CATALOG.md`, `concept-coverage.md`) and all 218 `crypto-lab-*`
clones (`README.md`, `*.ts`, `index.html`) for: `functional encryption`, `IPFE`, `inner product`,
`inner-product`, `ABDP`, `ALS16`, `function-hiding`, `functional key`.

**Result: no existing coverage.** Zero hits in every lab and in the catalog, with one near-miss that
is a different thing: `crypto-lab-bulletproofs` describes "the inner-product argument", which is the
IPA proof-compression technique inside Bulletproofs, not inner-product functional encryption. They
should not be conflated.

`crypto-lab-attribute-gate` implements FAME CP-ABE and is confirmed adjacent (4 `CP-ABE` and 15
`FAME` mentions in its README). Exhibit 7 credits it by name and link, states that it implements
FAME CP-ABE over BLS12-381, and draws the distinction explicitly rather than implying ABE is absent
from the fleet.

**Per the brief, no shipped copy anywhere in this lab says "first", "only", or "no other lab".** The
sweep is reported here; it is not an authority for a superlative in the card or the README.

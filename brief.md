# BUILD BRIEF — crypto-lab-function-key

Binding spec: `CRYPTO-LAB-TEMPLATE.md` in this repo — a gitignored working copy of
`audits/_MASTER-TEMPLATE.md` from the catalog. This brief fills the template's NEW DEMO
BRIEF block and the seven §1 sections. Where this brief and the template disagree, the
template wins; report the conflict rather than resolving it silently.

*A previous revision named the file `_MASTER-TEMPLATE.md`. No such file is in this repo,
so the brief pointed at something that does not exist — corrected to the name actually on
disk.*

Naming note: "Function Key" is proposed because the lab's object is a key that unlocks one function. If Paul prefers `crypto-lab-ipfe-gate`, rename before first commit and grep the catalog for collisions either way.

---

## NEW DEMO BRIEF

| Field | Value |
|---|---|
| **Repo name** | `crypto-lab-function-key` |
| **Short name (H1)** | Function Key |
| **Subtitle (spec label)** | Inner-product functional encryption · DDH (ABDP15) · ristretto255 |
| **One-liner** | Ordinary decryption releases the message; a functional key releases only ⟨x, y⟩ — until enough keys add up to the whole message. |
| **Concept to teach** | Functional encryption: a key for function f reveals f(x) and nothing else. Its two honest boundaries — the discrete-log decryption bottleneck and linear reconstruction from enough keys — are executable, not described. |
| **Primitives / spec** | ABDP15 DDH-based IPFE over a prime-order group (ristretto255); baby-step giant-step for the final discrete log; exact rational linear algebra for reconstruction. |
| **`--accent`** | **ASSIGNED CENTRALLY — do not set a value in this repo.** *A previous revision proposed `#4f46e5`. That is outside the catalog's four-colour rotation (`#35d6bb`, `#ffb84d`, `#ff6b7f`, `#9f88ff`), and four cards already carry off-palette accents with no recorded reason. Leave `--accent` undefined here; central assignment picks it from the palette against the 4-, 2- and 1-column layouts.* |
| **Favicon** | **ASSIGNED CENTRALLY — do not set one.** *A previous revision proposed 🔑, which is the single most contested emoji in the fleet — four labs already use it (`otp-vault`, `rsa-educational`, `shamir-vs-frost`, `x3dh-wire`). Central assignment will pick something that says "a key that answers one question" rather than "a key".* |
| **In scope** | Setup / KeyDer / Encrypt / Decrypt; bounded-range BSGS with a measured cost curve; reconstruction of x from k functional outputs (showing the affine solution family for k < n); master-secret recovery from n independent keys alone; ABE / IPFE / FHE comparison panel. |
| **Non-goals** | General-function FE (iO-territory); ALS16 adaptive-security variant; LWE or Paillier IPFE (named in the honesty panel as the fix for the dlog bound, not built); function-hiding, multi-input or multi-client IPFE; CCA security. |

---

## Thesis

Encryption releases *x*. FE releases *f(x)*. The lab makes that difference concrete for f = ⟨·, y⟩, then shows two limits:

1. **Output range.** DDH-IPFE decrypts to g^⟨x,y⟩; recovering the integer needs a discrete log. It works only because the answer is small. The cost is measured and plotted.
2. **The functionality itself leaks.** n linearly independent outputs *are* x. And because sk_y = ⟨s, y⟩, n independent keys *are* the master secret s, without any ciphertext. The UI must say plainly that neither breaks the scheme: ABDP15's security game only constrains key queries with ⟨x₀,y⟩ = ⟨x₁,y⟩, and n independent such queries force x₀ = x₁. The limit is in what was authorized, not in the proof.

The second point is the strongest teaching moment and gets the most screen time.

---

## §1 SCOPE

**Real:**
- ristretto255 group ops via a vetted library (`@noble/curves` — confirm the ristretto255 export name and API in the installed version).
- ABDP15 DDH scheme, implemented by the lab:
  - Setup: s ← Z_ℓⁿ; mpk = (g, h_i = g^{s_i}). *Read from ABDP15 Construction 3.1, Section 3
    "Inner-Product from DDH". The paper itself sets mpk = (h_i) and leaves g in the re-usable
    public parameters from GroupGen; folding g in is a packaging choice, not a deviation — say so
    rather than implying the paper writes it this way.*
  - KeyDer(y): sk_y = ⟨s, y⟩ mod ℓ.
  - Encrypt(x): r ← Z_ℓ; ct₀ = g^r; ct_i = h_i^r · g^{x_i}.
  - Decrypt(ct, y, sk_y): ∏ ct_i^{y_i} / ct₀^{sk_y} = g^⟨x,y⟩ → BSGS over [−B, B].
- BSGS with an exact group-operation counter.
- Reconstruction and master-key recovery on the real outputs and keys.

**Modeled:** the "authority" and "analyst" roles are panels on one page; no key distribution protocol.

**Not implemented (honesty panel):** adaptive security (ALS16); LWE / Paillier variants that lift the small-output restriction; general FE; any claim of CCA security — ciphertexts are additively malleable (demonstrated as a single claim, not an act).

---

## §1 SECURITY / CORRECTNESS INVARIANTS

Each is a claim in `e2e/claims.spec.ts`; each rendered verdict gets a §4.1c mutation.

1. **Correctness.** Decrypt returns exactly ⟨x, y⟩ over the integers for all fixtures, cross-checked against a plain integer dot product computed in the test, not imported from the lab.
2. **Randomized encryption.** Two encryptions of the same x differ in every component.
3. **Out-of-range is failure, not a wrong answer.** If |⟨x,y⟩| > B, BSGS reports "not found in range"; it never returns a wrapped value.
4. **Cost law.** Group ops for BSGS over range width W grow as Θ(√W). The chart plots measured op counts (wall-clock is secondary and labelled as machine-dependent). A claim checks the ratio across at least three widths stays within a stated tolerance of √ scaling.
5. **Partial keys, partial knowledge.** With k < n independent keys, the lab displays the solution set for x as an affine subspace of dimension n − k and must not display a unique x. Tested by fixture: two distinct x agreeing on all k outputs, both shown as consistent.
6. **Full reconstruction.** With n independent keys, x is recovered exactly (rational Gaussian elimination, BigInt fractions, no floats) and matches the encrypted x.
7. **Master-secret recovery.** With n independent keys and **no ciphertext**, s is recovered mod ℓ; proof: derive sk for a fresh y′ never issued and decrypt a fresh ciphertext correctly with it.
8. **Dependence detection.** A key set of rank < n is reported as such; recovery is refused with the rank shown.
9. **Malleability (single claim).** ct(x) ⊙ ct(x′) (componentwise) decrypts to ⟨x + x′, y⟩. Shown in the honesty panel as "CPA only."

---

## §1 ARCHITECTURE

- Single-page Vite/TS per template; GitHub Pages; no backend.
- `src/crypto/ipfe.ts` — scheme only.
- `src/crypto/dlog.ts` — BSGS with op counter; symmetric range.
- `src/crypto/linalg.ts` — exact rational and mod-ℓ elimination.
- `src/crypto/attacks.ts` — reconstruction and master-key recovery, calling `ipfe.ts` outputs; no parallel implementation.
- Verdicts computed at render; no literal success strings.

**Vectors:** no standardized IPFE vectors exist to the author's knowledge; do not label anything "official." Pin deterministic fixtures (seeded s, r) and cross-check per §4.1b with an independent re-derivation in the test that does not import `ipfe.ts`. **Optional:** generate fixtures offline from the FENTEC GoFE or CiFEr DDH IPFE implementation if their group/encoding can be matched to ristretto255; if not matchable, skip rather than approximate, and record why.

**Parameter caps (browser):** n ≤ 8; entries of x and y in a small signed range; BSGS width capped so the baby-step table stays tractable in-browser — pick the cap by measurement and state it in the UI.

---

## §1 UI

Plain-language intro before any group elements.

1. **Two kinds of key** — the same encrypted vector opened with an ordinary decryption (reveals x) vs a functional key for y (reveals one number). Plain words: "the second key answers one question about the data."
2. **Decrypt** — show g^⟨x,y⟩ as an opaque group element first; then BSGS turns it into an integer. The dlog step is visible, not hidden.
3. **Bottleneck** — slider for the output bound B; live op-count chart with the √ curve overlaid; the out-of-range failure demonstrated at the edge.
4. **Collect keys** — analyst requests keys one at a time. After each, show what is now known: the affine family of x consistent with the outputs, its dimension shrinking. At rank n, x snaps to one point.
5. **Keys alone** — no ciphertext; n keys → s → a key for a vector the authority never approved, which decrypts correctly. Explain why the security definition permits this.
6. **Where IPFE sits** — comparison panel:
   - ABE: controls *whether* plaintext is released.
   - IPFE: controls *which function* of plaintext is released.
   - FHE: lets a server compute *without learning* the plaintext; the key holder learns the result.
7. **Honesty panel** — real / modeled / not implemented; threat model.

Cross-links (verify slugs against the catalog; do not guess): ElGamal / Curve Lens → Attribute Gate → FHE lab. Do not reteach DDH or ElGamal; one sentence plus link.

**Threat model shown in UI:** authority trusted to generate keys; key holders may collude (the lab shows exactly what collusion yields); security is selective IND-CPA under DDH (ABDP15); adaptive security needs ALS16 (not built); no CCA.

---

## §1 VISUAL SEMANTICS

- x is never drawn in the analyst's panel until Invariant 6 computes it. Before that, only the affine family is drawn.
- The opaque group element and the recovered integer are visually distinct; never render the integer before BSGS finishes.
- The keys-alone act uses a distinct warning treatment; it must not look like a scheme break.
- No decorative motion.

---

## §1 EDGE CASES

- y = 0 → sk = 0, output 0; handled and explained.
- Duplicate or scalar-multiple y → rank does not increase; UI says so.
- Negative inner products → symmetric BSGS range handles them.
- Output exactly at ±B (inside) and ±(B+1) (outside).
- Scalars reduced mod ℓ for keys vs integers for x and y — the lab must never mix them silently; conversions are explicit.

---

## §1 EXTENSION SEAMS

- ALS16 adaptive variant.
- LWE / Paillier IPFE to remove the small-output bound.
- Function-hiding IPFE (pairings) — link to pairing labs.
- Multi-client IPFE for aggregate statistics.

---


---

## HERO — three roles, and they must say different things

The template (§3.1) requires the hero to carry three distinct texts, and the usual failure
is making the description and the why-box restate each other. Write them so each answers a
different question:

- **Subtitle** — the spec label only. Not a sentence. (See the NEW DEMO BRIEF row above.)
- **Description** — one sentence on WHAT you will see and do here, mechanism-first.
- **Why it matters** — two or three sentences on the STAKES. Never a paraphrase of the
  description.

## BUILD DISCIPLINE — gates before UI, and the traps that have actually cost time

These are not style notes. Each one is a failure that happened while building a sibling lab
in this fleet, and each cost more to diagnose than it costs to avoid.

**1. Verify the library before you trust it, and record what you verified against.**
Every dependency that does cryptography gets checked against a PUBLISHED vector before any
lab code is written on top of it — not its own README's claim, a vector from the spec or a
standards body. Pin that check as a test so it keeps holding. A wrapper that is subtly wrong
looks exactly like a lab that is subtly wrong, and you will look for the bug in your own code.

**2. A vendored or wrapped primitive can have a silent-wrong-answer precondition.**
A sibling lab's vendored pairing engine required both arguments in affine form and returned
a plausible-looking wrong field element otherwise, with no throw — while the multiply
functions it was paired with returned projective points. Two false test failures were chased
before the cause was found. If you wrap anything, put ONE chokepoint in front of it that
normalises or validates, and write a test that shows the raw call giving a different answer.
Do not leave the precondition as a comment.

**3. The preview port is not a free choice.** Vite's default is 4173 and labs across this
fleet collide on it. Playwright's `reuseExistingServer` sees *something* answering and hands
the suites a DIFFERENT lab's build, so the gates run green or red against a page this repo
never produced. Pick a port no sibling `playwright.config.ts` claims, and name it in exactly
one constant that `baseURL`, `webServer.command` and `webServer.url` all read.

**4. A checker only ever seen agreeing cannot be trusted.** If every fixture passes, a
mutation that forces the comparison true changes nothing observable and your suite proves
nothing. Ship a deliberately WRONG fixture alongside the real ones, render it as a row like
any other, and assert it is reported as failing. And print BOTH the computed and the expected
value on every row, always — not only when they differ. A badge that is the only evidence for
its own claim is unfalsifiable from the page.

**5. Mutation hygiene (§4.1c), stated because it went wrong.** Commit the real work BEFORE
mutating. One mutation at a time, restored immediately. Never stage or commit while a
mutation harness is running — a background harness held a file mid-mutation during a `git
add` and the mutation shipped; CI caught it, but only because the claims suite runs before
the Pages artifact uploads. And a mutation that leaves every test green proves nothing about
the tests: check whether it actually changed rendered output before recording it as a miss.

**6. Scope every claim to the mechanism that produces it.** The largest defect class here is
a right conclusion reached through a wrong causal chain. Before shipping any sentence about
what an attack or a limitation shows, write down the exact inputs that are wrong, which check
passes, and why — then check the sentence against that. "X does not prove Y" is almost always
too broad; "X does not pin WHICH Y, only that both sides agreed on one" is usually the true
statement.

## Claims & CI (existing mechanisms only)

- `e2e/claims.spec.ts` (§4.1b): Invariants 1–9, including the independent re-derivation and plain-integer dot-product cross-check.
- §4.1c mutations: drop ct₀ from decrypt; skip mod-ℓ reduction in KeyDer; asymmetric BSGS range; float elimination in `linalg`; claim rank n on a rank-deficient set. Each must turn a claim red.
- §4.1d negative claims: "one key does not determine x" (two consistent x fixture); "out-of-range decrypt returns no value."
- Playwright functional tests for every act; §4 axe/WCAG gate.

## Catalog checks for the agent (run and report)

- Sweep the catalog and the lab clones for existing functional-encryption coverage and REPORT what you find. Do not write "first", "only" or "no other lab" into shipped copy on the strength of a sweep. Search `functional encryption`, `IPFE`, `inner product`, `ABDP`, `ALS16`, and note that `crypto-lab-attribute-gate` implements FAME CP-ABE — adjacent, and the comparison panel must get the distinction right rather than implying ABE is absent.
- Confirm category placement (ENCRYPTION or PRIVACY) and report neighbouring cards for the accent check.

## Primary sources (verified Sep 29, 2026 unless marked)

- M. Abdalla, F. Bourse, A. De Caro, D. Pointcheval, *Simple Functional Encryption Schemes for Inner Products*, PKC 2015; ePrint 2015/017 — the construction built here.
- S. Agrawal, B. Libert, D. Stehlé, *Fully Secure Functional Encryption for Inner Products, from Standard Assumptions*, CRYPTO 2016; ePrint 2015/608 — adaptive security; LWE and Paillier variants that avoid the small-output restriction.
- D. Boneh, A. Sahai, B. Waters, *Functional Encryption: Definitions and Challenges*, TCC 2011,
  LNCS 6597, pp. 253-273; **ePrint 2010/543** — definitions. *The ePrint year (2010) differs from
  the conference year (2011); `2011/543` is a different paper. The ePrint page itself says
  "Unknown where it was published", so the venue was corroborated from IACR's TCC 2011 archive
  and from ABDP15's and ALS16's bibliographies, which independently give the same volume and
  pages.*
- RFC 9496, *The ristretto255 and decaf448 Groups*, IRTF/CFRG, Informational, December 2023
  (de Valence, Grigg, Hamburg, Lovecruft, Tankersley, Valsorda) — the group this lab builds on.
  **Appendix A publishes pinnable ristretto255 vectors**: A.1 multiples of the generator,
  A.2 invalid encodings, A.3 elements from uniform byte strings, A.4 square-root helpers. Pin the
  relevant ones as the library's trust anchor per BUILD DISCIPLINE item 1, before writing scheme
  code on top of it.
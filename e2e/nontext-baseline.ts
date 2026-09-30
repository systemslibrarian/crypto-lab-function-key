/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 *
 * IT IS EMPTY, AND THAT IS THE POINT — this is the terminal state of the
 * ratchet, not an unrun check.
 *
 * Why it came up empty on the first full drive: the boundary problem was
 * designed out before any CSS was written rather than discovered afterwards.
 * `styles.css` carries TWO border tokens instead of one, and the split is the
 * whole reason this file is empty. `--border` (#2f4340) is decorative — panel
 * edges, table rules, the footer divider — and measures about 1.7:1 against the
 * page, which is fine for a separator and would fail instantly as a control
 * edge. `--control-border` (#6b8d86) is the control token, and it was chosen by
 * computing ratios against all four surface levels before use: its worst case,
 * against `--raised`, is 4.09:1, well clear of the 3:1 floor. Every `.btn`,
 * `.tab-btn`, `input`, `select`, `.dim-cell`, `.swatch` and `.tag` draws its
 * edge from that token.
 *
 * Two controls override it and pass on fill instead: `.btn-primary` and the
 * selected `.tab-btn` both paint their border the same colour as their accent
 * fill, so neither has an edge of its own. They clear 3:1 on fill-vs-surround
 * because the accent resolves to the fleet's teal fallback (10.2:1 against the
 * page).
 *
 * THAT LAST POINT IS THE ONE TO RE-READ WHEN THIS FILE STOPS BEING EMPTY.
 * `--accent` is deliberately UNDEFINED in this repo; the catalog assigns it
 * centrally, and until then those two controls are measured against
 * `var(--accent, #35d6bb)`. A dark accent would reduce that fill-vs-surround
 * ratio, and `.btn-primary` and the selected tab are the two shapes that would
 * report first. The fix then is to give those two an explicit
 * `--control-border` edge, NOT to list them here.
 *
 * The shared top bar's `.cl-btn`, baselined in older labs at ~1.49:1, draws its
 * edge from `--cl-ink` in the current header and clears 3:1 — which is why the
 * entries much of this fleet carries are absent here too.
 *
 * A run with `NT_BASELINE_CAPTURE=1` set prints every finding through this
 * same path and asserts nothing, which is how this file is regenerated.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};

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
 * on the accent alone.
 *
 * THAT WAS THE POINT TO RE-READ WHEN `--accent` ARRIVED, SO HERE IS THE READING.
 * The catalog assigned `#ffb84d` on 2026-09-30. Measured against `--bg`
 * (#0d1412) that is **10.85:1**, where the teal fallback it replaces measured
 * 10.20:1 — the assignment moved the ratio UP, so neither control needs the
 * explicit `--control-border` edge a dark accent would have forced, and this
 * file stays empty. The warning is left standing rather than deleted, because
 * it is still the right instruction for the next accent: a DARK one reduces
 * fill-vs-surround, `.btn-primary` and the selected tab are the two shapes that
 * report first, and the fix then is to give those two an explicit
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

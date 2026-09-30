/**
 * Small rendering helpers.
 *
 * The verdict helper is the important one. Every verdict on this page is
 * computed at render time from a comparison of two values; there is no literal
 * "PASS" or "OK" string anywhere in the panel code that is not selected by a
 * boolean derived from the actual computation. That is what lets a source
 * mutation turn a claim red instead of leaving a hardcoded badge in place.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type VerdictTone = 'ok' | 'fail' | 'warn' | 'info';

/**
 * A verdict badge: icon glyph + word + colour, never colour alone (WCAG 1.4.1).
 *
 * `id` becomes `data-verdict`, which is how the claims suite addresses each
 * rendered verdict.
 */
export function verdict(id: string, tone: VerdictTone, label: string): string {
  const icon = tone === 'ok' ? '✓' : tone === 'fail' ? '✕' : tone === 'warn' ? '!' : 'i';
  return (
    `<span class="verdict verdict-${tone}" data-verdict="${escapeHtml(id)}" ` +
    `data-tone="${tone}">` +
    `<i class="verdict-icon" aria-hidden="true">${icon}</i>` +
    `<span>${escapeHtml(label)}</span>` +
    `</span>`
  );
}

/**
 * Choose a verdict from a boolean, so the tone and the word are both functions
 * of the computation rather than of the author's intent.
 */
export function verdictFor(
  id: string,
  pass: boolean,
  okLabel: string,
  failLabel: string,
): string {
  return verdict(id, pass ? 'ok' : 'fail', pass ? okLabel : failLabel);
}

/** Render a vector as (a, b, c). */
export function vec(v: readonly bigint[]): string {
  return `(${v.join(', ')})`;
}

/** A definition-list row pair. */
export function kv(rows: readonly (readonly [string, string])[]): string {
  return (
    '<dl class="kv">' +
    rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join('') +
    '</dl>'
  );
}

export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

/** Parse a signed integer from an input, clamped to the lab's entry range. */
export function clampEntry(raw: string, min: number, max: number): bigint {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.max(min, Math.min(max, n)));
}

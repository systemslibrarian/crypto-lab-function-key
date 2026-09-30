/**
 * Generate the Open Graph card: `public/og.png`, 1200x630.
 *
 * The card shows the rank-collapse moment, because that is the one image that
 * carries what the lab is about — three keys leave the plaintext a plane, the
 * fourth leaves it a point. A social preview of a hero title would say nothing
 * a reader could not guess from the link text.
 *
 * Rendered with the Playwright Chromium this repo already installs for its
 * a11y gate, so it adds no dependency. The numbers are the lab's real stage-3
 * scenario, not decoration: xA = (2, 3, 1, 4), the four key vectors it offers,
 * and the ranks each one produces.
 *
 *   node scripts/make-og.mjs
 *
 * Re-run it after changing the palette or the stage-3 scenario. The output is
 * committed, because a build that has to launch a browser to produce a static
 * asset is a build that breaks in environments that cannot.
 */

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'og.png');

// Kept in step with src/styles.css by hand. These are the tokens the card uses.
const T = {
  bg: '#0d1412',
  surface: '#131c1a',
  surface2: '#18231f',
  border: '#2f4340',
  controlBorder: '#6b8d86',
  text: '#e9f3f0',
  dim: '#adc2bc',
  muted: '#94aca6',
  ok: '#5fd39b',
  warn: '#ffc266',
  accent: '#35d6bb', // the fleet fallback; --accent is assigned centrally
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};

const ROWS = [
  { y: [1, 1, 0, 0], rank: 1 },
  { y: [0, 0, 1, 2], rank: 2 },
  { y: [1, 0, 0, 0], rank: 3 },
  { y: [0, 0, 1, 0], rank: 4 },
];

const cell = (v) =>
  `<td style="padding:4px 12px;text-align:right;font-family:${T.mono};font-weight:700;
     color:${v === 0 ? T.muted : T.text};font-size:20px">${v}</td>`;

const html = `<!doctype html><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:630px;background:${T.bg};color:${T.text};
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       display:flex;flex-direction:column;justify-content:space-between;
       padding:52px 60px;overflow:hidden}
  .kicker{font-family:${T.mono};font-size:17px;letter-spacing:.18em;color:${T.accent};
          text-transform:uppercase}
  h1{font-size:62px;line-height:1.02;letter-spacing:.01em;margin-top:10px}
  .sub{font-family:${T.mono};font-size:20px;color:${T.dim};margin-top:12px}
  .body{display:flex;gap:44px;align-items:center;margin-top:8px}
  .matrix{background:${T.surface};border:1px solid ${T.border};border-radius:12px;padding:16px 20px}
  .matrix th{font-family:${T.mono};font-size:13px;letter-spacing:.06em;color:${T.dim};
             text-transform:uppercase;padding:0 12px 8px;text-align:right;font-weight:600}
  .rank{font-family:${T.mono};font-size:15px;color:${T.ok};padding-left:18px;white-space:nowrap}
  .story{flex:1}
  .story p{font-size:25px;line-height:1.42;color:${T.dim}}
  .story strong{color:${T.text}}
  .meters{display:flex;gap:30px;margin-top:26px}
  .m{display:flex;flex-direction:column;gap:8px}
  .m .lbl{font-family:${T.mono};font-size:13px;letter-spacing:.08em;color:${T.muted};
          text-transform:uppercase}
  .cells{display:flex;gap:5px}
  .c{width:34px;height:13px;border-radius:3px;border:1px solid ${T.controlBorder}}
  .c.on{background:${T.accent}}
  .answer{font-family:${T.mono};font-size:31px;font-weight:700;color:${T.ok}}
  .foot{display:flex;justify-content:space-between;align-items:flex-end}
  .foot .url{font-family:${T.mono};font-size:18px;color:${T.muted}}
  .badge{font-family:${T.mono};font-size:14px;letter-spacing:.1em;color:${T.warn};
         border:1px solid ${T.warn};border-radius:7px;padding:6px 12px;text-transform:uppercase}
</style>
<body>
  <div>
    <div class="kicker">Functional encryption &middot; ABDP15 &middot; ristretto255</div>
    <h1>Function Key</h1>
    <div class="sub">one key answers one question &mdash; until enough keys answer all of them</div>
  </div>

  <div class="body">
    <div class="matrix">
      <table>
        <tr><th>y&#8321;</th><th>y&#8322;</th><th>y&#8323;</th><th>y&#8324;</th><th></th></tr>
        ${ROWS.map(
          (r) =>
            `<tr>${r.y.map(cell).join('')}<td class="rank">rank ${r.rank}${
              r.rank === 4 ? ' &larr; x is pinned' : ''
            }</td></tr>`,
        ).join('')}
      </table>
    </div>
    <div class="story">
      <p>Three independent keys leave the plaintext a <strong>plane</strong>.<br>
         The fourth leaves it a <strong>point</strong>.</p>
      <div class="meters">
        <div class="m">
          <span class="lbl">after 3 keys</span>
          <div class="cells"><span class="c on"></span><span class="c on"></span><span class="c on"></span><span class="c"></span></div>
          <span class="lbl" style="color:${T.dim}">1 dimension still free</span>
        </div>
        <div class="m">
          <span class="lbl">after 4 keys</span>
          <div class="cells"><span class="c on"></span><span class="c on"></span><span class="c on"></span><span class="c on"></span></div>
          <span class="answer">x = (2, 3, 1, 4)</span>
        </div>
      </div>
    </div>
  </div>

  <div class="foot">
    <span class="url">systemslibrarian.github.io/crypto-lab-function-key</span>
    <span class="badge">not production &middot; teaching demo</span>
  </div>
</body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();

const { size } = fs.statSync(out);
console.log(`wrote ${path.relative(root, out)} (${(size / 1024).toFixed(1)} kB, 1200x630)`);

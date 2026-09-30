import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build served by `vite preview`, so what
 * passes here is what ships. Three suites:
 *   - a11y.spec.ts    — the axe WCAG gate, Chromium only (deterministic gate).
 *   - claims.spec.ts  — the claims suite: does the page tell the truth.
 *   - flows.spec.ts   — role-based functional scenarios, incl. a mobile viewport.
 *
 * THE PORT IS ONE CONSTANT, READ THREE TIMES.
 *
 * `PORT` below feeds `baseURL`, `webServer.command` and `webServer.url`. That
 * is deliberate rather than tidy: Playwright's `reuseExistingServer` sees
 * *something* answering on a port and hands the suites whatever is there, so a
 * port that collides with a sibling lab silently runs these gates against a
 * DIFFERENT lab's build — green or red against a page this repo never
 * produced. It has really happened in this fleet (`bb84` reported
 * `kdf-chain`'s violations). Three literals drifting apart is the other way in.
 *
 * 4683 was checked against every sibling before being chosen: it appears in no
 * committed or working-tree `playwright.config.*` in the 218 `crypto-lab-*`
 * clones here, and is unclaimed in the catalog's own `tools/playwright-ports.json`
 * registry. Never the Vite default 4173.
 */
const PORT = 4683;
const BASE = `http://localhost:${PORT}/crypto-lab-function-key/`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // ONE WORKER, ALWAYS. The a11y gate is a measurement, and measurements taken
  // under CPU contention are not the same measurement: a first full-suite run
  // here had the gate fail against a page that passed in isolation seconds
  // later. The suite is under two minutes serial, which is a cheap price for a
  // gate whose red means something. It also keeps the responsiveness budget in
  // flows.spec.ts honest — that test times main-thread tasks, and a second
  // browser competing for the same cores would make its budget meaningless.
  workers: 1,
  timeout: 180_000, // the axe driver walks eight panels and ~30 states before finishing
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE,
    colorScheme: 'dark', // dark is the only theme
  },
  projects: [
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    {
      name: 'claims',
      testMatch: /claims\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    {
      name: 'flows-chromium',
      testMatch: /flows\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'flows-mobile',
      testMatch: /flows\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    // Build before serving. `vite preview` only serves whatever is already in
    // dist/, so without the build in front a run tests a stale bundle — and a
    // build that FAILS leaves the previous good bundle in place, so the whole
    // suite passes green against source that no longer compiles. That silently
    // invalidates mutation checking, which is the only way we prove a test has
    // teeth. With the build in front, a compile error aborts the run instead.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

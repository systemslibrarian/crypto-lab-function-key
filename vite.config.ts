// `defineConfig` comes from vitest/config rather than vite so that the `test`
// block below typechecks. Vite 8's own UserConfigExport has no `test` key, so
// importing from 'vite' here makes `tsc --noEmit` fail on the very exclusion
// the template requires. Same file, same config — just the typed entry point.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Read from the real repo name. A wrong base 404s every asset under the
  // GitHub Pages project subpath.
  base: '/crypto-lab-function-key/',
  build: { target: 'es2022' },
  test: {
    // Keep Playwright specs out of the Vitest run (template section 1). Without
    // this, e2e/*.spec.ts get collected as unit tests and fail on import.
    include: ['src/**/*.test.ts'],
  },
})

import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Shared by both projects. Repeated per project rather than only at the top
 * level because a project does not inherit the root `resolve`.
 */
const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer')
}

export default defineConfig({
  test: {
    // Every spy and fn mock is restored to its original implementation
    // after each test, so a stub set up in one test (e.g. `window.confirm`)
    // can never leak into the next test in the same file.
    restoreMocks: true,
    /**
     * Two environments, routed by file extension.
     *
     * `.test.ts` runs under Node exactly as it always has; `.test.tsx` gets
     * jsdom and the React transform. Splitting by extension rather than by
     * directory keeps the renderer's pure-logic tests — filter, detail,
     * navigation — where they already are, under Node, where they belong.
     *
     * `projects` rather than `workspace`: vitest 4 removed the latter.
     */
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['test/**/*.test.tsx'],
          setupFiles: ['test/renderer/setup.ts']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      // Only sources, and only real modules: pointed at `src/**` the v8
      // provider tries to parse index.html as a module and logs a rollup
      // PARSE_ERROR on every run.
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'json-summary'],
      // A ratchet, not a target: these sit a little below the coverage this
      // branch actually achieves (statements 95.11%, branches 89.91%,
      // functions 94.26%, lines 97.08%), so the suite fails if coverage
      // regresses but doesn't trip on ordinary day-to-day noise. Raise them
      // as coverage genuinely improves — never lower them to make a change
      // pass.
      thresholds: {
        statements: 94.5,
        branches: 89,
        functions: 93.5,
        lines: 96.5
      }
    }
  },
  resolve: { alias }
})

import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLES, DEFAULT_LANGUAGE, LANGUAGES, setLanguage } from '@shared/i18n'

afterEach(() => {
  // `current` is module-level state shared across the whole worker (see
  // `language.test.ts`), so a language left switched here would surface as a
  // baffling failure in an unrelated file, not in this one.
  setLanguage(DEFAULT_LANGUAGE)
})

type Interpolator = (...args: unknown[]) => unknown

/**
 * Distinctive enough that none can appear in real prose by accident, in
 * either language — unlike `'x'` or `1`, which a broken interpolator could
 * easily echo back by coincidence. `Math.random()` is unavailable in some
 * contexts here, so these are fixed literals rather than generated ones.
 * Three cover every arity actually present in `Strings` (max is two, for
 * entries such as `errors.actionFailed`); a fourth is spare headroom so a
 * future higher-arity entry fails loudly instead of silently under-testing.
 */
const SENTINELS = ['QQXZ7714', 'ZQXW2289', 'VJKT3350', 'HWNB6647'] as const

/**
 * Recurses a bundle and collects every function-valued leaf, keyed by its
 * dotted path (e.g. `"errors.launchFailed"`) so a failure names the exact
 * entry rather than just "some function somewhere".
 *
 * Deliberately generic — no key names are hard-coded — so this keeps
 * covering new entries as they are added instead of going stale the moment
 * someone extends `Strings`.
 */
function collectInterpolators(
  node: unknown,
  path: string,
  out: Array<[string, Interpolator]>
): void {
  if (typeof node === 'function') {
    out.push([path, node as Interpolator])
    return
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectInterpolators(value, path ? `${path}.${key}` : key, out)
    }
  }
}

describe('bundle interpolation', () => {
  for (const language of LANGUAGES) {
    const bundle = BUNDLES[language]
    const entries: Array<[string, Interpolator]> = []
    collectInterpolators(bundle, '', entries)

    describe(language, () => {
      // Not an assertion of equality with the other language — the `Strings`
      // interface already forces both bundles to implement the same shape,
      // and re-checking that would just duplicate the compiler. This is
      // purely a record of what the sweep found, for the two counts to be
      // compared by eye when reviewing this test's output.
      it(`found ${entries.length} function-valued entries`, () => {
        expect(entries.length).toBeGreaterThan(0)
      })

      it.each(entries)('%s interpolates every one of its arguments', (path, fn) => {
        setLanguage(language)

        const arity = fn.length
        expect(arity, `${path} takes no arguments — nothing to interpolate`).toBeGreaterThan(0)
        expect(
          arity,
          `${path} has arity ${arity}; add more entries to SENTINELS`
        ).toBeLessThanOrEqual(SENTINELS.length)

        // Every function-valued entry in both bundles interpolates its
        // arguments straight into a template — none formats a number (no
        // `toFixed`/`padStart`/`Intl` call in i18n.ts, confirmed by
        // inspection). So a plain string sentinel per position is enough
        // even for the numeric-looking parameters (`shown`, `total`,
        // `status`): JavaScript does not enforce the declared parameter
        // types at runtime, and `${sentinel}` interpolates a string exactly
        // as it would a number. Should a future entry ever format rather
        // than interpolate a number, calling it with a string would throw
        // here instead of silently passing — a fair trade against having to
        // hard-code per-key parameter types in a sweep meant to stay generic.
        const args = SENTINELS.slice(0, arity)
        const result = fn(...args)

        expect(typeof result, `${path} did not return a string`).toBe('string')
        for (const [index, sentinel] of args.entries()) {
          expect(
            result as string,
            `${path} dropped argument #${index} (expected to find "${sentinel}")`
          ).toContain(sentinel)
        }
      })
    })
  }
})

/**
 * The store country from Electron's system locale.
 *
 * `app.getLocale()` returns a BCP 47 tag, and its second segment is not
 * dependably a country: `zh-Hans-CN` is language-script-region, so the
 * second segment is the script; `es-419` is language-region where the
 * region is a UN numeric area code, not a country; and a bare `de` has no
 * region segment at all. Reading a fixed second segment turned all three
 * into a country Steam's `cc=` and Epic's `country=` have never heard of
 * ("HANS", "419") or silently wrong ("US" for a German system with no
 * region).
 *
 * The *last* segment is the one BCP 47 actually uses for region when a tag
 * carries one, and requiring it to be exactly two letters is what rejects
 * "419" and "Hans" rather than passing them through as if they were codes.
 *
 * A bare two-letter tag with no region at all — just "de" — has no better
 * candidate than its own primary subtag, so that is what this returns. It
 * is a guess, not a lookup, but it is a closer guess than the US default
 * the old code gave every such system regardless of what language it ran
 * in.
 */
export function countryFromLocale(locale: string): string {
  const last = locale.split('-').pop()
  return last !== undefined && /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : 'US'
}

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
 * A bare tag with no region at all — just "de" — falls back to the default
 * rather than reusing its own language subtag. Language codes and country
 * codes are separate namespaces that only coincide by luck: "de" happens to
 * land on Germany, but "sv" is Swedish and El Salvador, "et" is Estonian and
 * Ethiopia, "ca" is Catalan and Canada, and "uk" is Ukrainian and nothing at
 * all (the United Kingdom is "GB"). Guessing there would ask Steam and Epic
 * for a real but wrong region's promotions, which is worse than asking for
 * the default one — and far harder to notice, because it looks right for the
 * handful of languages where the two namespaces happen to agree.
 *
 * Chromium returns a bare tag routinely on Linux, so this is not a rare path.
 */
export function countryFromLocale(locale: string): string {
  const parts = locale.split('-')
  // Only when the tag actually carries a region segment; a one-part tag has
  // a language there, not a country.
  const last = parts.length > 1 ? parts.at(-1) : undefined
  return last !== undefined && /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : 'US'
}

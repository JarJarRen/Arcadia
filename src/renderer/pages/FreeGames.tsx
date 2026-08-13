import { useState, type ReactElement } from 'react'
import type { Freebie, FreebieKind } from '@shared/freebies'
import type { StoreId } from '@shared/types'
import { t } from '@shared/i18n'
import { filterFreebies } from '../filter'
import { useFreebies } from '../hooks/useFreebies'
import { FreebieCard } from '../components/FreebieCard'
import { FilterControls } from '../components/FilterControls'
import { SettingsMenu } from '../components/SettingsMenu'

type KindFilter = 'all' | FreebieKind

const CHIPS: readonly KindFilter[] = ['all', 'game', 'dlc', 'loot']

function chipLabel(kind: KindFilter): string {
  const labels = t().freebies.kind
  if (kind === 'all') return labels.all
  if (kind === 'game') return labels.game
  if (kind === 'dlc') return labels.dlc
  return labels.loot
}

// The visible label is short by design ("All", "DLC"); the tooltip says
// what the filter does instead of just repeating it.
function chipHint(kind: KindFilter): string {
  const hints = t().freebies.kindHint
  if (kind === 'all') return hints.all
  if (kind === 'game') return hints.game
  if (kind === 'dlc') return hints.dlc
  return hints.loot
}

function keepKind(rows: Freebie[], kind: KindFilter): Freebie[] {
  return kind === 'all' ? rows : rows.filter((row) => row.kind === kind)
}

/**
 * One headed grid, or nothing when the section is empty.
 *
 * Both sections render identically — the only difference is the heading —
 * so they share this rather than repeating the map twice.
 */
function Section({
  heading,
  rows,
  now,
  onClaim
}: {
  heading: string
  rows: Freebie[]
  now: number
  onClaim: (freebie: Freebie) => void
}): ReactElement | null {
  if (rows.length === 0) return null
  return (
    <>
      <h3>{heading}</h3>
      <div className="freebies__grid">
        {rows.map((freebie) => (
          <FreebieCard key={freebie.id} freebie={freebie} now={now} onClaim={onClaim} />
        ))}
      </div>
    </>
  )
}

interface Props {
  onClose: () => void
  /** Reopens the configuration screen — the gear needs this page's own
      copy since the page covers the toolbar that would otherwise host it. */
  onOpenSetup: () => void
  /** The library's search text. One filter serves both pages. */
  search: string
  /** The stores to show, ORed. Empty means every store. */
  stores: StoreId[]
  /** The stores switched on in the configuration screen. */
  availableStores: StoreId[]
  onSearchChange: (search: string) => void
  onStoresChange: (stores: StoreId[]) => void
}

export function FreeGames({
  onClose,
  onOpenSetup,
  search,
  stores,
  availableStores,
  onSearchChange,
  onStoresChange
}: Props): ReactElement {
  const { list, loading, error, refresh, claim } = useFreebies()
  const [kind, setKind] = useState<KindFilter>('all')
  const now = Date.now()
  const refreshLabel = loading ? t().freebies.refreshing : t().freebies.refresh

  const current = filterFreebies(keepKind(list.current, kind), search, stores)
  const upcoming = filterFreebies(keepKind(list.upcoming, kind), search, stores)

  // Nothing found and nothing fetched are different states. The first is
  // news about the world; the second is news about Arcadia.
  const unreachable = list.fetchedAt === undefined && list.failures.length > 0
  // Unfiltered: `empty` is a claim about the world ("nothing is free"), while
  // every control on this page — the chip, the search, the store filter —
  // narrows what was asked for instead. Deriving this from
  // `current`/`upcoming` after the DLC chip narrows five Epic games to zero
  // DLC rows would say the first thing while meaning the second.
  const empty = list.current.length === 0 && list.upcoming.length === 0
  // The other half of that split. Without it, a search matching nothing would
  // claim nothing is free — and the chip, which could always narrow to zero,
  // would leave the page silently blank as it did before.
  const narrowedToNothing = !empty && current.length === 0 && upcoming.length === 0

  // One handler shared by both sections, rather than an inline arrow
  // repeated per Section: the two would otherwise be indistinguishable to
  // both readers and coverage tooling.
  const handleClaim = (row: Freebie): void => void claim(row)

  return (
    <section className="freebies">
      <header className="freebies__header">
        {/* First, and in the same order as the library toolbar: switching
            pages must not move the control under the cursor. Only these two
            have to line up — everything after them is free to differ, which
            is what lets this page keep its own title, chips and refresh. */}
        <FilterControls
          search={search}
          stores={stores}
          available={availableStores}
          onSearchChange={onSearchChange}
          onStoresChange={onStoresChange}
        />
        <h2>{t().freebies.title}</h2>
        <div className="freebies__chips" role="group">
          {CHIPS.map((value) => (
            <button
              key={value}
              type="button"
              className="button"
              aria-pressed={kind === value}
              title={chipHint(value)}
              onClick={() => setKind(value)}
            >
              {chipLabel(value)}
            </button>
          ))}
        </div>
        {/* Icon only, matching the library toolbar's refresh — the label
            lives in the tooltip and the accessible name instead of on the
            button. */}
        <button
          type="button"
          className="button button--icon"
          disabled={loading}
          aria-label={refreshLabel}
          title={refreshLabel}
          onClick={refresh}
        >
          <span aria-hidden="true">⟳</span>
        </button>
        {list.fetchedAt !== undefined && (
          <span className="freebies__asof">
            {t().freebies.asOf(
              new Date(list.fetchedAt).toLocaleString(t().format.locale, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
              })
            )}
          </span>
        )}
        {/* Last rather than first: the search box and the store filter have
            to start this row to line up with the library's. The label still
            says where it goes, which is what stopped a bare × from reading
            as "dismiss" when it led the row. */}
        <button type="button" className="button freebies__back" onClick={onClose}>
          {t().freebies.back}
        </button>
        {/* The gear the library toolbar renders — this page covers the
            toolbar while it is open, so without its own copy the
            configuration screen and the language switch are unreachable
            from here. Reused rather than copied: one popover, one place
            its markup can drift. */}
        <SettingsMenu onOpenSetup={onOpenSetup} />
      </header>

      <div className="freebies__body">
        {list.failures.map((failure) => (
          <p key={failure} className="banner banner--notice" role="status">
            {failure}
          </p>
        ))}
        {error !== undefined && (
          <p className="banner banner--error" role="alert">
            {error}
          </p>
        )}

        {unreachable && <p className="freebies__empty">{t().freebies.unavailable}</p>}
        {/* A thrown initial load leaves `list` at the empty default (no
            failures recorded, so `unreachable` is false) while `error` holds
            the real reason. Without this guard the empty message and the
            error banner above would both render, giving two different
            explanations for the same bare page. */}
        {!unreachable && empty && !loading && error === undefined && (
          <p className="freebies__empty">{t().freebies.empty}</p>
        )}
        {!unreachable && narrowedToNothing && !loading && error === undefined && (
          <p className="freebies__empty">{t().freebies.noMatches}</p>
        )}

        <Section
          heading={t().freebies.currentHeading}
          rows={current}
          now={now}
          onClaim={handleClaim}
        />
        <Section
          heading={t().freebies.upcomingHeading}
          rows={upcoming}
          now={now}
          onClaim={handleClaim}
        />
      </div>
    </section>
  )
}

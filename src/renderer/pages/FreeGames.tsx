import { useState, type ReactElement } from 'react'
import type { Freebie, FreebieKind } from '@shared/freebies'
import { t } from '@shared/i18n'
import { useFreebies } from '../hooks/useFreebies'
import { FreebieCard } from '../components/FreebieCard'

type KindFilter = 'all' | FreebieKind

const CHIPS: readonly KindFilter[] = ['all', 'game', 'dlc', 'loot']

function chipLabel(kind: KindFilter): string {
  const labels = t().freebies.kind
  if (kind === 'all') return labels.all
  if (kind === 'game') return labels.game
  if (kind === 'dlc') return labels.dlc
  return labels.loot
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

export function FreeGames({ onClose }: { onClose: () => void }): ReactElement {
  const { list, loading, error, refresh, claim } = useFreebies()
  const [kind, setKind] = useState<KindFilter>('all')
  const now = Date.now()

  const current = keepKind(list.current, kind)
  const upcoming = keepKind(list.upcoming, kind)

  // Nothing found and nothing fetched are different states. The first is
  // news about the world; the second is news about Arcadia.
  const unreachable = list.fetchedAt === undefined && list.failures.length > 0
  // Unfiltered: `empty` is a claim about the world ("nothing is free"), and
  // a chip is a claim about what the user asked to see. Deriving this from
  // `current`/`upcoming` after the DLC chip narrows five Epic games to zero
  // DLC rows would say the first thing while meaning the second.
  const empty = list.current.length === 0 && list.upcoming.length === 0

  // One handler shared by both sections, rather than an inline arrow
  // repeated per Section: the two would otherwise be indistinguishable to
  // both readers and coverage tooling.
  const handleClaim = (row: Freebie): void => void claim(row)

  return (
    <section className="freebies">
      <header className="freebies__header">
        <h2>{t().freebies.title}</h2>
        <div className="freebies__chips" role="group">
          {CHIPS.map((value) => (
            <button
              key={value}
              type="button"
              className="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {chipLabel(value)}
            </button>
          ))}
        </div>
        <button type="button" className="button" onClick={refresh} disabled={loading}>
          {t().freebies.refresh}
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
        <button
          type="button"
          className="button button--icon"
          aria-label={t().common.close}
          onClick={onClose}
        >
          ×
        </button>
      </header>

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
    </section>
  )
}

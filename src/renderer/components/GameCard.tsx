import type { ReactElement } from 'react'
import type { LibraryEntry } from '@shared/library'
import { t } from '@shared/i18n'
import { formatPlaytime, formatSize } from '../filter'
import { StoreSwitch } from './StoreSwitch'
import { STORE_LABELS } from './storeLabels'

interface Props {
  entry: LibraryEntry
  onLaunch: (entry: LibraryEntry) => void
  onToggleFavorite: (entry: LibraryEntry) => void
  onSelectStore: (entry: LibraryEntry, gameId: string) => void
  onSplit: (entry: LibraryEntry) => void
  onOpen: (entry: LibraryEntry) => void
  onInstall: (entry: LibraryEntry) => void
}

export function GameCard({
  entry,
  onLaunch,
  onToggleFavorite,
  onSelectStore,
  onSplit,
  onOpen,
  onInstall
}: Props): ReactElement {
  const grid =
    entry.artwork.find((image) => image.kind === 'grid') ??
    entry.artwork.find((image) => image.kind === 'hero')
  const playtime = formatPlaytime(entry.playtimeMinutes)
  const size = formatSize(entry.installSizeBytes)
  const activeStore = STORE_LABELS[entry.active.storeId] ?? entry.active.storeId

  return (
    <article className={`card ${entry.installed ? '' : 'card--not-installed'}`}>
      {/* Until the metadata has been fetched the initials stand in — a tile
          must not look empty. If an image breaks, it falls back to the same
          placeholder rather than showing a broken-image icon. */}
      <div className="card__art" aria-hidden="true">
        {grid === undefined ? (
          entry.name.slice(0, 2).toUpperCase()
        ) : (
          <img
            className="card__image"
            src={grid.url}
            alt=""
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = 'none'
              // Steam's URLs are derived from the AppID, so some point at
              // nothing. Reporting it drops the row and lets SteamGridDB
              // fill the gap on the next pass; hiding alone left the tile
              // blank for good.
              void window.arcadia.reportBrokenArtwork(entry.key, grid.kind)
            }}
          />
        )}
      </div>

      <div className="card__body">
        {/* A real button that CSS stretches across image and title: a click
            anywhere on the tile opens the details page, and the keyboard
            still reaches it. Putting an <h3> inside the button would be
            invalid HTML — a button takes phrasing content, not a heading. */}
        <h3 className="card__title" title={entry.name}>
          <button type="button" className="card__open" onClick={() => onOpen(entry)}>
            {entry.name}
          </button>
        </h3>
        <p className="card__meta">
          {/* Show every store, not just the active one: otherwise a merged
              game gives no hint that it exists more than once. */}
          {entry.sources.map((source) => (
            <span key={source.id} className="badge">
              {STORE_LABELS[source.storeId] ?? source.storeId}
            </span>
          ))}
          {/* “Shared/Free” rather than “Family sharing”: which of the two it
              is cannot be decided from Steam's data — Team Fortress 2 and
              Anno 1800 sit in the same list. */}
          {entry.sharedOrFree && (
            <span className="badge badge--shared" title={t().card.sharedOrFreeTitle}>
              {t().card.sharedOrFree}
            </span>
          )}
          {playtime !== undefined && <span>{playtime}</span>}
          {entry.installed && size !== undefined && <span>{size}</span>}
          {!entry.installed && <span>{t().card.notInstalled}</span>}
        </p>
      </div>

      <StoreSwitch
        entry={entry}
        onSelect={(gameId) => onSelectStore(entry, gameId)}
        onSplit={() => onSplit(entry)}
      />

      <div className="card__actions">
        {/* This used to be a dead button labelled “Not installed”. The same
            spot now leads to the store's dialog — Arcadia downloads nothing
            itself, it only opens the launcher. */}
        {entry.active.installed ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => onLaunch(entry)}
          >
            {t().card.play}
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary button--install"
            title={t().card.installVia(activeStore)}
            onClick={() => onInstall(entry)}
          >
            {t().card.install}
          </button>
        )}
        <button
          type="button"
          className="button button--icon"
          aria-pressed={entry.favorite}
          aria-label={entry.favorite ? t().card.removeFavorite : t().card.addFavorite}
          onClick={() => onToggleFavorite(entry)}
        >
          {entry.favorite ? '★' : '☆'}
        </button>
      </div>
    </article>
  )
}

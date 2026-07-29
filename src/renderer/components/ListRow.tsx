import type { ReactElement } from 'react'
import type { LibraryEntry } from '@shared/library'
import { t } from '@shared/i18n'
import { formatPlaytime, formatSize } from '../filter'
import { pickArtwork } from '../detail'
import { STORE_LABELS } from './storeLabels'

interface Props {
  entry: LibraryEntry
  selected: boolean
  onSelect: (entry: LibraryEntry) => void
}

/**
 * One row of the list view.
 *
 * The whole row is the button rather than the title alone: a list is scanned
 * and clicked at speed, and a one-word hit target in a 380px row is a miss
 * waiting to happen. The grid tile keeps its narrower target because there
 * the artwork is the obvious thing to aim at.
 */
export function ListRow({ entry, selected, onSelect }: Props): ReactElement {
  const playtime = formatPlaytime(entry.playtimeMinutes)
  const size = formatSize(entry.installSizeBytes)
  const grid = pickArtwork(entry.artwork, 'grid')

  return (
    <li className="listrow__item">
      <button
        type="button"
        className={`listrow${selected ? ' listrow--selected' : ''}${
          entry.installed ? '' : ' listrow--not-installed'
        }`}
        aria-current={selected}
        onClick={() => onSelect(entry)}
      >
        {/* Same fallback as the tile: initials until the metadata arrives,
            and again if the image fails to load. A row with a hole where the
            thumbnail should be reads as broken. */}
        <span className="listrow__art" aria-hidden="true">
          {grid === undefined ? (
            entry.name.slice(0, 2).toUpperCase()
          ) : (
            <img
              className="listrow__image"
              src={grid.url}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
                void window.arcadia.reportBrokenArtwork(entry.key, grid.kind)
              }}
            />
          )}
        </span>

        <span className="listrow__text">
          <span className="listrow__name" title={entry.name}>
            {entry.name}
          </span>
          <span className="listrow__meta">
            {entry.sources.map((source) => (
              <span key={source.id} className="badge">
                {STORE_LABELS[source.storeId] ?? source.storeId}
              </span>
            ))}
            {entry.sharedOrFree && (
              <span className="badge badge--shared" title={t().card.sharedOrFreeTitle}>
                {t().card.sharedOrFree}
              </span>
            )}
            {playtime !== undefined && <span>{playtime}</span>}
            {entry.installed && size !== undefined && <span>{size}</span>}
            {!entry.installed && <span>{t().card.notInstalled}</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

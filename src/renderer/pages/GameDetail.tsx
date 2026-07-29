import { useEffect, useState, type ReactElement } from 'react'
import type { LibraryEntry } from '@shared/library'
import { t } from '@shared/i18n'
import { formatPlaytime, formatSize } from '../filter'
import { formatLastPlayed, pickArtwork, storeOrigins } from '../detail'
import { STORE_LABELS } from '../components/storeLabels'
import { MatchDialog } from '../components/MatchDialog'

/**
 * Full page, or the right-hand half of the split list view.
 *
 * `pane` stacks the facts under the description instead of beside it: in a
 * pane narrowed by a 380px list, the 320px facts column would squeeze the
 * description to roughly 500px on a 1400px window. It also hides the back
 * button, since the list it would return to is already on screen.
 */
type DetailVariant = 'page' | 'pane'

interface Props {
  entry: LibraryEntry
  variant?: DetailVariant
  onClose: () => void
  onLaunch: (entry: LibraryEntry) => void
  onToggleFavorite: (entry: LibraryEntry) => void
  onSelectStore: (entry: LibraryEntry, gameId: string) => void
  onInstall: (entry: LibraryEntry) => void
}

/**
 * How many screenshots the gallery shows at most.
 *
 * Measured against the real library: the median is 10, the maximum **181**.
 * Showing all of them would mean pulling 181 images from Valve's servers
 * for a single game — the page would be busy for minutes and nobody would
 * look at them. Twelve is more than most games have.
 */
const MAX_SCREENSHOTS = 12

function Fact({
  label,
  children
}: {
  label: string
  children: ReactElement | string
}): ReactElement {
  return (
    <div className="fact">
      <dt className="fact__label">{label}</dt>
      <dd className="fact__value">{children}</dd>
    </div>
  )
}

export function GameDetail({
  entry,
  variant = 'page',
  onClose,
  onLaunch,
  onToggleFavorite,
  onSelectStore,
  onInstall
}: Props): ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [folderError, setFolderError] = useState<string | undefined>()
  const [lightboxImage, setLightboxImage] = useState<string | undefined>()

  const hero = pickArtwork(entry.artwork, 'hero')
  const meta = entry.metadata
  const screenshots = (meta?.screenshots ?? []).slice(0, MAX_SCREENSHOTS)
  const playtime = formatPlaytime(entry.playtimeMinutes)
  const size = formatSize(entry.installSizeBytes)
  const lastPlayed = formatLastPlayed(entry.lastPlayed)

  // Escape closes the innermost layer first: the lightbox, then the dialog,
  // then the page. That order is the expectation — Escape should peel off
  // the top layer, not everything at once.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (lightboxImage !== undefined) setLightboxImage(undefined)
      else if (dialogOpen) setDialogOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxImage, dialogOpen, onClose])

  /**
   * Deletes a hand-made entry.
   *
   * Confirmed first: unlike every other action on this page it destroys
   * something, and the entry was typed in by hand — re-entering it is real
   * work, not a click.
   *
   * Only the manual sources are removed. A merged entry can hold both a
   * manual placeholder and a scanned game; deleting the whole thing would
   * take the scanned one with it, and the main process would refuse that
   * anyway.
   */
  const remove = async (): Promise<void> => {
    if (!window.confirm(t().detail.removeManualConfirm)) return
    for (const source of entry.sources.filter((s) => s.manual === true)) {
      const result = await window.arcadia.removeManualGame(source.id)
      if (!result.ok) {
        setFolderError(result.error)
        return
      }
    }
    onClose()
  }

  const openFolder = async (): Promise<void> => {
    try {
      const result = await window.arcadia.openFolder(entry.key)
      setFolderError(result.ok ? undefined : result.error)
    } catch (caught) {
      setFolderError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <main className={variant === 'pane' ? 'detail detail--pane' : 'detail'}>
      <header className="detail__hero">
        {hero !== undefined && (
          <img
            className="detail__heroimage"
            src={hero.url}
            alt=""
            onError={(event) => {
              event.currentTarget.style.display = 'none'
              void window.arcadia.reportBrokenArtwork(entry.key, hero.kind)
            }}
          />
        )}
        <div className="detail__herotext">
          {/* No way back from the pane — the list is already beside it. */}
          {variant === 'page' && (
            <button type="button" className="button detail__back" onClick={onClose}>
              {t().detail.back}
            </button>
          )}
          <h1 className="detail__title">{entry.name}</h1>
        </div>
      </header>

      {folderError !== undefined && (
        <p className="banner banner--error" role="alert">
          <span>{folderError}</span>
          <button
            type="button"
            className="banner__close"
            aria-label={t().common.dismissMessage}
            onClick={() => setFolderError(undefined)}
          >
            ×
          </button>
        </p>
      )}

      <div className="detail__cols">
        <section className="detail__main">
          {meta?.shortDescription !== undefined && (
            <p className="detail__summary">{meta.shortDescription}</p>
          )}

          {screenshots.length > 0 && (
            <div className="gallery">
              {screenshots.map((url) => (
                <button
                  key={url}
                  type="button"
                  className="gallery__button"
                  onClick={() => setLightboxImage(url)}
                  aria-label={t().detail.enlargeScreenshot}
                >
                  <img className="gallery__image" src={url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}

          {meta?.description !== undefined && (
            <div className="detail__text">{meta.description}</div>
          )}

          {meta === undefined && <p className="hint hint--left">{t().detail.noMetadata}</p>}
        </section>

        <aside className="detail__side">
          <div className="detail__actions">
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

          {/* The local facts sit above the store facts on purpose: they are
              what no store supplies, and the reason this app has a details
              page of its own at all. */}
          <dl className="facts">
            {entry.sharedOrFree && (
              <Fact label={t().detail.origin}>{t().detail.originShared}</Fact>
            )}
            {playtime !== undefined && <Fact label={t().detail.playtime}>{playtime}</Fact>}
            {lastPlayed !== undefined && (
              <Fact label={t().detail.lastPlayed}>{lastPlayed}</Fact>
            )}
            {size !== undefined && <Fact label={t().detail.size}>{size}</Fact>}

            <Fact label={entry.sources.length > 1 ? t().detail.availableAt : t().detail.store}>
              <span className="origins">
                {storeOrigins(entry).map((source) => (
                  <button
                    key={source.gameId}
                    type="button"
                    className={`storeswitch__option ${
                      source.active ? 'storeswitch__option--active' : ''
                    }`}
                    // With only one source there is nothing to choose — the
                    // button would stay a button that does nothing.
                    disabled={entry.sources.length === 1}
                    onClick={() => onSelectStore(entry, source.gameId)}
                    title={source.installed ? t().detail.installed : t().detail.notInstalled}
                  >
                    {STORE_LABELS[source.storeId] ?? source.storeId}
                    {!source.installed && ' ·'}
                  </button>
                ))}
              </span>
            </Fact>

            {entry.installPath !== undefined && (
              <Fact label={t().detail.folder}>
                <>
                  <span className="path">{entry.installPath}</span>
                  <button
                    type="button"
                    className="button detail__folder"
                    onClick={() => void openFolder()}
                  >
                    {t().detail.openInFileManager}
                  </button>
                </>
              </Fact>
            )}

            {meta !== undefined && (
              <>
                {meta.genres.length > 0 && (
                  <Fact label={t().detail.genres}>{meta.genres.join(', ')}</Fact>
                )}
                {meta.developers.length > 0 && (
                  <Fact label={t().detail.developers}>{meta.developers.join(', ')}</Fact>
                )}
                {meta.publishers.length > 0 && (
                  <Fact label={t().detail.publishers}>{meta.publishers.join(', ')}</Fact>
                )}
                {meta.releaseDate !== undefined && (
                  // Printed verbatim: Steam supplies localised prose, not an
                  // ISO date. Parsing it fell over on entries like "Coming
                  // soon".
                  <Fact label={t().detail.released}>{meta.releaseDate}</Fact>
                )}
                {/* Barely half the games carry a Metacritic score, which is
                    why it sits at the bottom and carries no weight. */}
                {meta.metacritic !== undefined && (
                  <Fact label={t().detail.metacritic}>{String(meta.metacritic)}</Fact>
                )}
              </>
            )}
          </dl>

          <button
            type="button"
            className="detail__correction"
            onClick={() => setDialogOpen(true)}
          >
            {meta === undefined ? t().detail.setMatch : t().detail.fixMatch}
          </button>

          {/* Only for entries this user typed in. A scanned game has no
              delete button, because deleting it would achieve nothing —
              the next scan brings it straight back. The main process
              refuses it too; this only keeps the button from being there
              to press. */}
          {entry.sources.some((source) => source.manual === true) && (
            <button type="button" className="detail__correction" onClick={() => void remove()}>
              {t().detail.removeManual}
            </button>
          )}
        </aside>
      </div>

      {dialogOpen && <MatchDialog entry={entry} onClose={() => setDialogOpen(false)} />}

      {lightboxImage !== undefined && (
        <div
          className="lightbox"
          role="presentation"
          onClick={() => setLightboxImage(undefined)}
        >
          <img className="lightbox__image" src={lightboxImage} alt="" />
        </div>
      )}
    </main>
  )
}

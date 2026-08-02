import { useRef, type ReactElement } from 'react'
import { t } from '@shared/i18n'
import { useDismiss } from '../hooks/useDismiss'

interface Props {
  /** The store's user-visible name, e.g. "Steam". */
  store: string
  onDismiss: () => void
}

/**
 * How long a wait may go unremarked before the overlay appears.
 *
 * With the store already running the answer comes back inside this, and
 * the overlay never appears at all. That is what keeps it from flashing on
 * every quick install — and it means the renderer never has to ask whether
 * guided installing is available on this platform.
 */
export const OVERLAY_DELAY_MS = 250

/**
 * The space the store's install dialog is about to land in.
 *
 * Its job is continuity: the dialog belongs to another application, and
 * without something here the user watches Arcadia sit idle for up to
 * twenty seconds and then get covered by a window from somewhere else.
 */
export function InstallOverlay({ store, onDismiss }: Props): ReactElement {
  const box = useRef<HTMLDivElement>(null)

  // Always dismissible. The wait is on another application's dialog, and a
  // user who cannot get out of it is trapped by a window we do not own.
  useDismiss(true, box, onDismiss)

  return (
    <div className="modal" role="presentation">
      <div className="modal__box modal__box--install" ref={box} role="status" aria-live="polite">
        <span className="install__spinner" aria-hidden="true" />
        <h2 className="modal__title">{t().install.overlayTitle(store)}</h2>
        <p className="modal__hint">{t().install.overlayBody}</p>
        <p className="modal__hint">{t().install.overlayDismiss}</p>
      </div>
    </div>
  )
}

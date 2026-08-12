import type { ReactElement } from 'react'
import type { Freebie } from '@shared/freebies'
import { t } from '@shared/i18n'
import { STORE_LABELS } from './storeLabels'

interface Props {
  freebie: Freebie
  /** Passed in rather than read here, so the countdown is testable. */
  now: number
  onClaim: (freebie: Freebie) => void
}

const DAY_MS = 86_400_000

function deadline(freebie: Freebie, now: number): string | undefined {
  if (freebie.startsAt !== undefined && freebie.startsAt > now) {
    return t().freebies.startsOn(
      new Date(freebie.startsAt).toLocaleDateString(t().format.locale, {
        day: 'numeric',
        month: 'long'
      })
    )
  }
  if (freebie.endsAt === undefined) return undefined

  const left = freebie.endsAt - now
  // Under a day is "today" rather than "in 1 day": the rounding would
  // otherwise report six hours as a whole day of breathing room.
  if (left < DAY_MS) return t().freebies.endsToday
  // Floor, not ceil: rounding up would tell someone with 25 hours left
  // that they have two days, and overstating time left on a deadline is
  // the direction that costs them the offer.
  return t().freebies.endsIn(Math.floor(left / DAY_MS))
}

function kindLabel(freebie: Freebie): string {
  const labels = t().freebies.kind
  if (freebie.kind === 'dlc') return labels.dlc
  if (freebie.kind === 'loot') return labels.loot
  return labels.game
}

function ClaimButton({ freebie, onClaim }: Omit<Props, 'now'>): ReactElement {
  const strings = t().freebies.claim

  // `owned` and `confirmed` read the same: both mean the game is in the
  // library, and the distinction between "we saw it happen" and "it was
  // already there" is not one the user needs to make.
  if (freebie.claim === 'confirmed' || freebie.claim === 'owned') {
    return (
      <p className="freebie__claimed" role="status">
        {strings.confirmed}
      </p>
    )
  }

  // A pending row is only ever written with an openedAt (see
  // src/main/db/freebies.ts), but the type allows its absence. Without a
  // recorded time there is nothing truthful to say about when it was
  // opened, so fall back to the same "not yet opened" label the unclaimed
  // branch uses rather than inventing a clock time.
  const pending = freebie.claim === 'pending'
  const inBrowser = freebie.storeGameId === undefined
  const label =
    pending && freebie.openedAt !== undefined
      ? strings.pending(
          new Date(freebie.openedAt).toLocaleTimeString(t().format.locale, {
            hour: '2-digit',
            minute: '2-digit'
          })
        )
      : inBrowser
        ? strings.inBrowser
        : strings.inStore(STORE_LABELS[freebie.storeId])

  // Same precedent as pendingHint: says where the click leads, never that
  // Arcadia adds the game to an account — it only opens a page.
  const hint = pending
    ? strings.pendingHint
    : inBrowser
      ? strings.inBrowserHint
      : strings.inStoreHint(STORE_LABELS[freebie.storeId])

  return (
    <button
      type="button"
      className="button freebie__claim"
      title={hint}
      onClick={() => onClaim(freebie)}
    >
      {label}
    </button>
  )
}

export function FreebieCard({ freebie, now, onClaim }: Props): ReactElement {
  // An offer that has not started yet gets no button: there is nothing to
  // claim, and a button that did nothing would be worse than none.
  const upcoming = freebie.startsAt !== undefined && freebie.startsAt > now
  const when = deadline(freebie, now)

  return (
    <article className="freebie">
      {freebie.imageUrl !== undefined && (
        <img className="freebie__art" src={freebie.imageUrl} alt="" loading="lazy" />
      )}
      <div className="freebie__body">
        <h3 className="freebie__title">{freebie.title}</h3>
        <p className="freebie__meta">
          <span className="freebie__store">{STORE_LABELS[freebie.storeId]}</span>
          <span className="freebie__kind">{kindLabel(freebie)}</span>
          {when !== undefined && <span className="freebie__when">{when}</span>}
        </p>
        {!upcoming && <ClaimButton freebie={freebie} onClaim={onClaim} />}
      </div>
    </article>
  )
}

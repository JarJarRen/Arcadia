import { useEffect, useState, type ReactElement } from 'react'
import { STORE_IDS, type AvailabilityResult, type StoreId } from '@shared/types'
import { t } from '@shared/i18n'
import { STORE_LABELS } from './storeLabels'

interface Props {
  enabled: StoreId[]
  onChange: (stores: StoreId[]) => void
}

/**
 * The store list in the configuration screen.
 *
 * Its own component rather than more markup in SetupDialog: the dialog is
 * about the API keys, this is about which stores exist, and this one has an
 * async probe of its own. The dialog stays the shell that arranges them.
 *
 * The probe never gates the checkboxes. It reads the registry through four
 * adapters and can take a moment; a list that could not be ticked until it
 * answered would feel broken for exactly as long as the slowest store.
 */
export function StoreSelection({ enabled, onChange }: Props): ReactElement {
  const [availability, setAvailability] = useState<
    Record<string, AvailabilityResult> | undefined
  >()
  const [auth, setAuth] = useState<{ signedIn: boolean; gamertag?: string }>({ signedIn: false })
  const [pending, setPending] = useState<{ userCode: string; verificationUri: string } | undefined>()
  const [authError, setAuthError] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    window.arcadia
      .getStoreAvailability()
      .then((result) => {
        if (!cancelled) setAvailability(result)
      })
      // Swallowed on purpose: not knowing whether a store is installed is no
      // reason to stop someone choosing it. The row keeps saying "checking".
      .catch((error: unknown) => console.error('Stores could not be probed:', error))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const refresh = (): void => {
      window.arcadia
        .getMicrosoftAuth()
        .then((state) => {
          setAuth(state)
          // The code has been used; there is nothing left to type.
          if (state.signedIn) setPending(undefined)
        })
        .catch((error: unknown) => console.error('Sign-in state could not be read:', error))
    }
    refresh()
    return window.arcadia.onMicrosoftAuthChanged(refresh)
  }, [])

  const toggle = (id: StoreId): void => {
    const next = enabled.includes(id)
      ? enabled.filter((store) => store !== id)
      : [...enabled, id]
    // Canonical order, so the stored value does not depend on the order the
    // boxes happened to be ticked in.
    onChange(STORE_IDS.filter((store) => next.includes(store)))
  }

  return (
    <fieldset className="modal__group">
      <legend className="modal__label">{t().setup.storesTitle}</legend>
      <p className="modal__sublabel">{t().setup.storesHint}</p>

      {STORE_IDS.map((id) => (
        <div key={id}>
          <label className="modal__toggle modal__toggle--store">
            <input
              type="checkbox"
              checked={enabled.includes(id)}
              onChange={() => toggle(id)}
            />
            <span>
              {STORE_LABELS[id] ?? id}
              <span className="modal__sublabel">{note(availability, id)}</span>
            </span>
          </label>
          {id === 'microsoft' && (
            <span className="modal__sublabel">
              {auth.signedIn ? (
                <>
                  {t().setup.microsoftSignedInAs(auth.gamertag ?? '')}{' '}
                  <button
                    type="button"
                    className="button button--link"
                    onClick={() => {
                      setPending(undefined)
                      void window.arcadia.signOutOfMicrosoft()
                    }}
                  >
                    {t().setup.microsoftSignOut}
                  </button>
                </>
              ) : pending === undefined ? (
                <button
                  type="button"
                  className="button button--link"
                  onClick={() => {
                    setAuthError(undefined)
                    window.arcadia
                      .signInToMicrosoft()
                      .then((started) => {
                        if (started.ok && started.userCode !== undefined && started.verificationUri !== undefined) {
                          setPending({
                            userCode: started.userCode,
                            verificationUri: started.verificationUri
                          })
                        } else {
                          setAuthError(started.error)
                        }
                      })
                      .catch((error: unknown) =>
                        setAuthError(error instanceof Error ? error.message : String(error))
                      )
                  }}
                >
                  {t().setup.microsoftSignIn}
                </button>
              ) : (
                <>
                  {t().setup.microsoftCodeHint(pending.userCode)}{' '}
                  {/* An ordinary link: the window's open handler denies
                      in-app navigation and hands the URL to the shell. */}
                  <a
                    className="modal__link"
                    href={pending.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t().setup.microsoftOpenLink}
                  </a>
                </>
              )}
              {authError !== undefined && <span className="modal__error">{authError}</span>}
            </span>
          )}
        </div>
      ))}
    </fieldset>
  )
}

/**
 * What a row says about the store beneath its name.
 *
 * Limitations as well as the reason: that is how a Ubisoft user learns their
 * owned games come from a local cache without having to read the source.
 */
function note(
  availability: Record<string, AvailabilityResult> | undefined,
  id: StoreId
): string {
  if (availability === undefined) return t().setup.storeChecking
  const result = availability[id]
  if (result === undefined) return t().setup.storeChecking
  if (!result.available) return result.reason ?? t().setup.storeNotFound
  const limitations = result.limitations ?? []
  return limitations.length === 0
    ? t().setup.storeDetected
    : `${t().setup.storeDetected} — ${limitations.join(' ')}`
}

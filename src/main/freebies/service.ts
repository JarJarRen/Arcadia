import type { FreebieList, RawFreebie } from '@shared/freebies'
import type { StoreId } from '@shared/types'
import { t } from '@shared/i18n'
import type { FetchFn } from '@main/metadata/steamAppList'
import type { FreebieRepository } from '@main/db/freebies'
import type { SettingsRepository } from '@main/db/settings'
import { fetchEpicFreebies } from './sources/epic'
import { fetchSteamFreebies } from './sources/steam'
import { fetchGamerPowerFreebies } from './sources/gamerpower'
import { claimTarget } from './claim'
import { dedupeFreebies, filterByStores, splitFreebies } from './merge'

/**
 * Six hours.
 *
 * Chosen against the shape of the thing being watched: Epic rotates weekly,
 * Steam promotions run for days. A shorter interval would add requests
 * without ever finding anything new.
 */
const TTL_MS = 6 * 3_600_000

/** Where the last successful refresh is remembered between starts. */
const FETCHED_AT_KEY = 'freebies-fetched-at'

/** Steam's spelling of the languages this app knows. */
const STEAM_LANGUAGE: Record<string, string> = { en: 'english', de: 'german' }

export interface FreebieServiceOptions {
  repo: FreebieRepository
  settings: SettingsRepository
  /** Where the interface language and the store country come from. */
  locale: () => { language: string; country: string }
  fetchFn?: FetchFn
}

export class FreebieService {
  /** Failures from the most recent attempt, already localised. */
  private failures: string[] = []
  /** The refresh in flight, so two callers share one set of requests. */
  private inFlight: Promise<void> | undefined

  constructor(private readonly options: FreebieServiceOptions) {}

  private get fetchedAt(): number | undefined {
    const stored = this.options.settings.get(FETCHED_AT_KEY)
    if (stored === undefined) return undefined
    const parsed = Number(stored)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  getList(stores: StoreId[], now: number): FreebieList {
    const rows = filterByStores(this.options.repo.list(), stores)
    const { current, upcoming } = splitFreebies(rows, now)
    return {
      current,
      upcoming,
      ...(this.fetchedAt === undefined ? {} : { fetchedAt: this.fetchedAt }),
      failures: [...this.failures]
    }
  }

  /**
   * Answers whether it actually went and looked.
   *
   * The caller sends `freebies:changed` only on true. Sending it
   * unconditionally loops: the renderer reloads on that event, the reload
   * calls `freebies:get`, and that handler refreshes behind its answer.
   * A TTL skip is precisely the case where nothing has changed and nobody
   * needs telling.
   */
  async refresh(now: number, force: boolean): Promise<boolean> {
    const last = this.fetchedAt
    if (!force && last !== undefined && now - last < TTL_MS) return false
    // Two callers — the startup refresh and a page that opened at the same
    // moment — share one set of requests rather than doubling them.
    this.inFlight ??= this.run(now).finally(() => {
      this.inFlight = undefined
    })
    await this.inFlight
    return true
  }

  private async run(now: number): Promise<void> {
    const { language, country } = this.options.locale()
    const fetchFn = this.options.fetchFn

    const attempts: Array<{ name: string; run: () => Promise<RawFreebie[]> }> = [
      {
        name: 'Epic',
        run: () => fetchEpicFreebies({ locale: language, country, now, fetchFn })
      },
      {
        name: 'Steam',
        run: () =>
          fetchSteamFreebies({
            country,
            language: STEAM_LANGUAGE[language] ?? 'english',
            fetchFn
          })
      },
      { name: 'GamerPower', run: () => fetchGamerPowerFreebies({ now, fetchFn }) }
    ]

    const settled = await Promise.allSettled(attempts.map((attempt) => attempt.run()))

    const rows: RawFreebie[] = []
    const failures: string[] = []
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') rows.push(...result.value)
      else failures.push(t().freebies.sourceFailed(attempts[index]!.name))
    })

    this.failures = failures

    // Every source down means we learned nothing — not that everything
    // ended. Writing an empty list here would throw away a perfectly good
    // cache and leave an offline start with a blank page.
    if (failures.length === attempts.length) return

    this.options.repo.replaceAll(dedupeFreebies(rows), now)
    this.options.settings.set(FETCHED_AT_KEY, String(now))
  }

  /** The validated target for a row, looked up by id. Throws otherwise. */
  claimById(id: string): string {
    const row = this.options.repo.find(id)
    if (row === undefined) throw new Error(`No such offer: ${id}`)
    return claimTarget(row)
  }

  markOpened(id: string, now: number): void {
    this.options.repo.markOpened(id, now)
  }
}

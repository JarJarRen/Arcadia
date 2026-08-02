/**
 * The library hook.
 *
 * The sequence guard is the reason this file exists. `reload` numbers each
 * load and drops an answer that arrives after a newer one was asked for —
 * without it a slow first response lands on top of a fast second one and
 * the library shows stale entries with no way back except another refresh.
 * That is a race, so it cannot be found by clicking around.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useLibrary } from '@renderer/hooks/useLibrary'
import { entry, game, stubArcadia } from './fixtures'

describe('useLibrary', () => {
  it('loads the library on mount', async () => {
    stubArcadia({ getGames: async () => [entry('TF2', [game('steam', '440', 'TF2')])] })

    const { result } = renderHook(() => useLibrary())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]!.name).toBe('TF2')
  })

  it('discards an answer that arrives after a newer request', async () => {
    // The race the sequence counter exists for: the first load is slow, a
    // change triggers a second, the second answers first. The slow first
    // answer must not overwrite it.
    const slow = [entry('Stale', [game('steam', '1', 'Stale')])]
    const fresh = [entry('Fresh', [game('steam', '2', 'Fresh')])]

    let release: () => void = () => undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })

    let call = 0
    let changed: (() => void) | undefined
    stubArcadia({
      getGames: async () => {
        call += 1
        if (call === 1) {
          await blocked
          return slow
        }
        return fresh
      },
      onLibraryChanged: (callback) => {
        changed = callback
        return () => undefined
      }
    })

    const { result } = renderHook(() => useLibrary())

    // Second load overtakes the first.
    await act(async () => {
      changed?.()
    })
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('Fresh'))

    // Now let the stale one land.
    await act(async () => {
      release()
      await blocked
    })

    expect(result.current.entries[0]!.name).toBe('Fresh')
  })

  it('reports a failed load as an error rather than an empty library', async () => {
    stubArcadia({
      getGames: async () => {
        throw new Error('database is locked')
      }
    })

    const { result } = renderHook(() => useLibrary())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toMatch(/database is locked/)
  })

  it('clears an error on request', async () => {
    stubArcadia({
      getGames: async () => {
        throw new Error('nope')
      }
    })

    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.error).toBeDefined())

    act(() => result.current.clearError())
    expect(result.current.error).toBeUndefined()
  })

  it('surfaces a scan that half failed', async () => {
    // Otherwise a partial failure only reaches the terminal and the Refresh
    // button looks as though everything went well.
    stubArcadia({
      sync: async () =>
        ({
          stores: [
            { storeId: 'steam', ok: true },
            { storeId: 'epic', ok: false, error: 'catalogue cache missing' }
          ]
        }) as Awaited<ReturnType<typeof window.arcadia.sync>>
    })

    const { result } = renderHook(() => useLibrary())
    await act(async () => {
      await result.current.sync()
    })

    expect(result.current.error).toContain('epic')
    expect(result.current.error).toContain('catalogue cache missing')
  })

  it('reports no error for a scan where every store succeeded', async () => {
    stubArcadia({
      sync: async () =>
        ({ stores: [{ storeId: 'steam', ok: true }] }) as Awaited<
          ReturnType<typeof window.arcadia.sync>
        >
    })

    const { result } = renderHook(() => useLibrary())
    await act(async () => {
      await result.current.sync()
    })

    expect(result.current.error).toBeUndefined()
  })

  it('clears the syncing flag even when the scan throws', async () => {
    stubArcadia({
      sync: async () => {
        throw new Error('scan exploded')
      }
    })

    const { result } = renderHook(() => useLibrary())
    await act(async () => {
      await result.current.sync()
    })

    expect(result.current.syncing).toBe(false)
    expect(result.current.error).toMatch(/scan exploded/)
  })

  it('names the action in an error from a write', async () => {
    stubArcadia({
      setFavorite: async () => {
        throw new Error('disk full')
      }
    })

    const { result } = renderHook(() => useLibrary())
    const target = entry('TF2', [game('steam', '440', 'TF2')])

    await act(async () => {
      await result.current.toggleFavorite(target)
    })

    expect(result.current.error).toMatch(/disk full/)
    expect(result.current.error).toMatch(/favourite/i)
  })

  it('toggles the favourite to the opposite of what the entry holds', async () => {
    const setFavorite = vi.fn(async () => undefined)
    stubArcadia({ setFavorite })

    const { result } = renderHook(() => useLibrary())
    const favourited = entry('TF2', [game('steam', '440', 'TF2', { favorite: true })])

    await act(async () => {
      await result.current.toggleFavorite(favourited)
    })

    expect(setFavorite).toHaveBeenCalledWith('tf2', false)
  })

  it('removes its library listener on unmount', async () => {
    // Without the returned disposer the listeners pile up on every React
    // remount and each change triggers as many reloads as there have been
    // mounts.
    const dispose = vi.fn()
    stubArcadia({ onLibraryChanged: () => dispose })

    const { unmount } = renderHook(() => useLibrary())
    unmount()

    expect(dispose).toHaveBeenCalledOnce()
  })
})

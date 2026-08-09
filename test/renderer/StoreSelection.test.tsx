/**
 * The store list in the configuration screen.
 *
 * The availability note is what makes switching a store off an informed
 * click rather than a guess, and it must never block the checkboxes: the
 * probe reads the registry and can take a moment.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StoreSelection } from '@renderer/components/StoreSelection'

function stubApi(availability: Record<string, unknown> = {}): void {
  ;(window as unknown as { arcadia: unknown }).arcadia = {
    getStoreAvailability: async () => availability
  }
}

describe('StoreSelection', () => {
  it('ticks the stores that are enabled', () => {
    stubApi()
    render(<StoreSelection enabled={['steam']} onChange={vi.fn()} />)

    expect((screen.getByRole('checkbox', { name: /steam/i }) as HTMLInputElement).checked).toBe(
      true
    )
    expect((screen.getByRole('checkbox', { name: /epic/i }) as HTMLInputElement).checked).toBe(
      false
    )
  })

  it('reports the whole selection when one store is ticked', () => {
    stubApi()
    const onChange = vi.fn()
    render(<StoreSelection enabled={['steam']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /epic/i }))

    expect(onChange).toHaveBeenCalledWith(['steam', 'epic'])
  })

  it('reports an empty selection when the last store is unticked', () => {
    stubApi()
    const onChange = vi.fn()
    render(<StoreSelection enabled={['steam']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /steam/i }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('says it is checking until the probe answers', () => {
    stubApi()
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    expect(screen.getAllByText(/checking/i).length).toBeGreaterThan(0)
  })

  it('shows the reason a store was not found', async () => {
    stubApi({ epic: { available: false, reason: 'No Epic Games Launcher here.' } })
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    expect(await screen.findByText(/No Epic Games Launcher here\./)).toBeDefined()
  })

  it('shows a limitation of a store that was found', async () => {
    stubApi({ ubisoft: { available: true, limitations: ['Owned games from a local cache.'] } })
    render(<StoreSelection enabled={[]} onChange={vi.fn()} />)

    expect(await screen.findByText(/Owned games from a local cache\./)).toBeDefined()
  })

  it('keeps the checkboxes usable when the probe fails', async () => {
    ;(window as unknown as { arcadia: unknown }).arcadia = {
      getStoreAvailability: async () => {
        throw new Error('nope')
      }
    }
    const onChange = vi.fn()
    render(<StoreSelection enabled={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /steam/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['steam']))
  })
})

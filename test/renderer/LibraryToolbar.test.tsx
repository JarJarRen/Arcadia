/**
 * The filter row.
 *
 * Nine controls that all funnel into one `onFilterChange`, each of which
 * must patch its own field and leave the rest alone. A control that
 * replaces the filter instead of extending it would silently reset the
 * other eight, which reads as "the search box clears my store filter" and
 * is hard to attribute to the right control.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LibraryToolbar } from '@renderer/components/LibraryToolbar'
import type { LibraryFilter } from '@renderer/filter'

const FILTER: LibraryFilter = {
  search: 'far cry',
  stores: ['steam'],
  onlyInstalled: false,
  onlyFavorites: false,
  shared: 'all'
}

function renderToolbar(overrides: Partial<Parameters<typeof LibraryToolbar>[0]> = {}) {
  const props = {
    filter: FILTER,
    sort: 'name' as const,
    sortDirection: 'asc' as const,
    view: 'grid' as const,
    total: 312,
    shown: 7,
    syncing: false,
    onFilterChange: vi.fn(),
    onSortChange: vi.fn(),
    onSortDirectionChange: vi.fn(),
    onViewChange: vi.fn(),
    onAddGame: vi.fn(),
    onSync: vi.fn(),
    onOpenSetup: vi.fn(),
    ...overrides
  }
  render(<LibraryToolbar {...props} />)
  return props
}

describe('LibraryToolbar', () => {
  it('patches only the search field when the search box changes', () => {
    const props = renderToolbar()

    fireEvent.change(screen.getByPlaceholderText('Search library…'), {
      target: { value: 'portal' }
    })

    expect(props.onFilterChange).toHaveBeenCalledWith({ ...FILTER, search: 'portal' })
  })

  it('patches only onlyInstalled when that box is ticked', () => {
    const props = renderToolbar()

    fireEvent.click(screen.getByLabelText('Installed only'))

    expect(props.onFilterChange).toHaveBeenCalledWith({ ...FILTER, onlyInstalled: true })
  })

  it('patches only onlyFavorites when that box is ticked', () => {
    const props = renderToolbar()

    fireEvent.click(screen.getByLabelText('Favourites only'))

    expect(props.onFilterChange).toHaveBeenCalledWith({ ...FILTER, onlyFavorites: true })
  })

  it('patches only the licence filter', () => {
    const props = renderToolbar()

    fireEvent.change(screen.getByLabelText('Licence'), { target: { value: 'only' } })

    expect(props.onFilterChange).toHaveBeenCalledWith({ ...FILTER, shared: 'only' })
  })

  it('reports a change of sort key', () => {
    const props = renderToolbar()

    fireEvent.change(screen.getByLabelText('Sorting'), { target: { value: 'playtime' } })

    expect(props.onSortChange).toHaveBeenCalledWith('playtime')
  })

  it('flips the sort direction', () => {
    const props = renderToolbar({ sortDirection: 'asc' })

    fireEvent.click(screen.getByLabelText('Sort direction: ascending'))

    expect(props.onSortDirectionChange).toHaveBeenCalledWith('desc')
  })

  it('names the direction rather than leaving a bare arrow', () => {
    // The arrow is aria-hidden, so this label is the entire accessible name.
    renderToolbar({ sortDirection: 'desc' })
    expect(screen.getByLabelText('Sort direction: descending')).toBeDefined()
  })

  it('switches the view mode', () => {
    const props = renderToolbar({ view: 'grid' })

    fireEvent.click(screen.getByTitle('List'))

    expect(props.onViewChange).toHaveBeenCalledWith('list')
  })

  it('marks the current view as pressed', () => {
    renderToolbar({ view: 'list' })

    expect(screen.getByTitle('List').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTitle('Grid').getAttribute('aria-pressed')).toBe('false')
  })

  it('reserves the count width for the widest label it can show', () => {
    // The sizer is what stops the row shifting sideways as the filter
    // changes: it holds the width of "312 of 312" while "7 of 312" is
    // displayed. jsdom cannot measure the shift itself, so what is pinned
    // here is that the sizer is present and carries the full-width text.
    renderToolbar({ shown: 7, total: 312 })

    expect(screen.getByText('7 of 312')).toBeDefined()
    expect(screen.getByText('312 of 312')).toBeDefined()
  })

  it('hides the sizer from assistive technology', () => {
    renderToolbar({ shown: 7, total: 312 })

    expect(screen.getByText('312 of 312').getAttribute('aria-hidden')).toBe('true')
  })

  it('names the refresh button by its state while a scan runs', () => {
    renderToolbar({ syncing: true })

    const button = screen.getByLabelText('Scanning…')
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('triggers a scan', () => {
    const props = renderToolbar({ syncing: false })

    fireEvent.click(screen.getByLabelText('Refresh'))

    expect(props.onSync).toHaveBeenCalledOnce()
  })

  it('opens the add-game dialog', () => {
    const props = renderToolbar()

    fireEvent.click(screen.getByText('+ Add game'))

    expect(props.onAddGame).toHaveBeenCalledOnce()
  })
})

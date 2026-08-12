/**
 * One offer.
 *
 * The button's wording is the whole point of the card: Arcadia opens a
 * store page and can confirm nothing until a later scan. Every label here
 * is chosen so it never claims to have added anything to an account.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FreebieCard } from '@renderer/components/FreebieCard'
import type { Freebie } from '@shared/freebies'

const NOW = Date.parse('2026-08-10T12:00:00.000Z')
const DAY_MS = 86_400_000

function freebie(overrides: Partial<Freebie> = {}): Freebie {
  return {
    id: 'epic:ghostrunner',
    storeId: 'epic',
    title: 'Ghostrunner',
    kind: 'game',
    storeGameId: 'ghostrunner',
    source: 'epic',
    claim: 'unclaimed',
    ...overrides
  }
}

describe('FreebieCard', () => {
  it('names the store the claim goes to', () => {
    render(<FreebieCard freebie={freebie()} now={NOW} onClaim={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Claim in Epic/ })).toBeTruthy()
  })

  it('says browser where there is no deep link', () => {
    render(
      <FreebieCard
        freebie={freebie({ storeGameId: undefined, claimUrl: 'https://x.ubisoft.com/y' })}
        now={NOW}
        onClaim={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Open in browser/ })).toBeTruthy()
  })

  it('offers to open again while a claim is pending', () => {
    // Never "claimed": Arcadia opened a door and cannot see whether anyone
    // walked through it.
    render(<FreebieCard freebie={freebie({ claim: 'pending' })} now={NOW} onClaim={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Open again' })).toBeTruthy()
  })

  it('reports a confirmed claim as being in the library', () => {
    render(<FreebieCard freebie={freebie({ claim: 'confirmed' })} now={NOW} onClaim={vi.fn()} />)
    expect(screen.getByText(/In your library/)).toBeTruthy()
  })

  it('reports an owned row as in the library too, with no claim button', () => {
    // Same wording as `confirmed` — the user does not need to know whether
    // Arcadia saw the claim happen or the game was already there.
    render(<FreebieCard freebie={freebie({ claim: 'owned' })} now={NOW} onClaim={vi.fn()} />)
    expect(screen.getByText(/In your library/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('hands the whole row to the claim handler', () => {
    const onClaim = vi.fn()
    const row = freebie()
    render(<FreebieCard freebie={row} now={NOW} onClaim={onClaim} />)
    fireEvent.click(screen.getByRole('button', { name: /Claim in Epic/ }))
    expect(onClaim).toHaveBeenCalledWith(row)
  })

  it('counts the days left', () => {
    render(
      <FreebieCard
        freebie={freebie({ endsAt: NOW + 2 * 86_400_000 })}
        now={NOW}
        onClaim={vi.fn()}
      />
    )
    expect(screen.getByText(/ends in 2 days/)).toBeTruthy()
  })

  it('says today rather than "in 0 days"', () => {
    render(
      <FreebieCard freebie={freebie({ endsAt: NOW + 3_600_000 })} now={NOW} onClaim={vi.fn()} />
    )
    expect(screen.getByText(/ends today/)).toBeTruthy()
  })

  it('shows a start date and no button for an upcoming offer', () => {
    render(
      <FreebieCard
        freebie={freebie({ startsAt: NOW + 4 * 86_400_000 })}
        now={NOW}
        onClaim={vi.fn()}
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('labels DLC and loot apart from a game', () => {
    render(<FreebieCard freebie={freebie({ kind: 'dlc' })} now={NOW} onClaim={vi.fn()} />)
    expect(screen.getByText('DLC')).toBeTruthy()
  })

  it('renders without artwork rather than an empty box', () => {
    render(<FreebieCard freebie={freebie({ imageUrl: undefined })} now={NOW} onClaim={vi.fn()} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Ghostrunner')).toBeTruthy()
  })

  it('shows the artwork when the offer has one', () => {
    render(
      <FreebieCard
        freebie={freebie({ imageUrl: 'https://cdn1.epicgames.com/ghostrunner.jpg' })}
        now={NOW}
        onClaim={vi.fn()}
      />
    )
    // alt="" resolves to the "presentation" role, not "img" — see
    // GameCard.test.tsx for the same correction against the naive guess.
    expect(screen.getByRole('presentation', { hidden: true }).getAttribute('src')).toBe(
      'https://cdn1.epicgames.com/ghostrunner.jpg'
    )
  })

  it('labels loot apart from a game or DLC', () => {
    render(<FreebieCard freebie={freebie({ kind: 'loot' })} now={NOW} onClaim={vi.fn()} />)
    expect(screen.getByText('Loot')).toBeTruthy()
  })

  it('shows "Open again" for a pending claim rather than a fabricated time', () => {
    // Freebie no longer carries an openedAt at all, so there is nothing left
    // to invent a clock time from — a pending row reads the same regardless
    // of when, or whether, the button was pressed before.
    render(<FreebieCard freebie={freebie({ claim: 'pending' })} now={NOW} onClaim={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Open again' })
    expect(button.textContent).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('shows exactly "Open again" and nothing else for a pending claim', () => {
    // The old bug was masked by a test that only checked for "open again"
    // as a substring, which passes even when nonsense precedes it.
    render(<FreebieCard freebie={freebie({ claim: 'pending' })} now={NOW} onClaim={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Open again$/ })).toBeTruthy()
  })

  it('says today just under the day boundary', () => {
    render(
      <FreebieCard
        freebie={freebie({ endsAt: NOW + DAY_MS - 1 })}
        now={NOW}
        onClaim={vi.fn()}
      />
    )
    expect(screen.getByText(/ends today/)).toBeTruthy()
  })

  it('says tomorrow at exactly one day left', () => {
    // The < DAY_MS guard only catches strictly less than a day; at exactly
    // 24h left the floor is a whole 1, so this is the tomorrow case, not today.
    render(
      <FreebieCard freebie={freebie({ endsAt: NOW + DAY_MS })} now={NOW} onClaim={vi.fn()} />
    )
    expect(screen.getByText(/ends tomorrow/)).toBeTruthy()
  })

  it('says tomorrow just over one day left', () => {
    render(
      <FreebieCard
        freebie={freebie({ endsAt: NOW + DAY_MS + 1 })}
        now={NOW}
        onClaim={vi.fn()}
      />
    )
    expect(screen.getByText(/ends tomorrow/)).toBeTruthy()
  })

  it('says tomorrow just under two days left, not two days', () => {
    render(
      <FreebieCard
        freebie={freebie({ endsAt: NOW + 2 * DAY_MS - 1 })}
        now={NOW}
        onClaim={vi.fn()}
      />
    )
    expect(screen.getByText(/ends tomorrow/)).toBeTruthy()
  })

  it('says 2 days at exactly two days left', () => {
    render(
      <FreebieCard freebie={freebie({ endsAt: NOW + 2 * DAY_MS })} now={NOW} onClaim={vi.fn()} />
    )
    expect(screen.getByText(/ends in 2 days/)).toBeTruthy()
  })

  it('says today for a deadline that has already passed', () => {
    render(
      <FreebieCard freebie={freebie({ endsAt: NOW - 60_000 })} now={NOW} onClaim={vi.fn()} />
    )
    expect(screen.getByText(/ends today/)).toBeTruthy()
  })
})

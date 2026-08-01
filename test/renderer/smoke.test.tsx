/**
 * Proves the DOM test project works at all.
 *
 * Kept after the renderer suites landed rather than deleted: when a config
 * change breaks jsdom, JSX transformation or RTL cleanup, this fails on its
 * own and says which of the three it was. Otherwise the breakage would
 * surface as twenty unrelated component tests failing at once.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

function Greeting({ name }: { name: string }): ReactElement {
  return <p>Hello {name}</p>
}

describe('DOM test environment', () => {
  it('renders JSX into a real document', () => {
    render(<Greeting name="Arcadia" />)
    expect(screen.getByText('Hello Arcadia')).toBeDefined()
  })

  it('starts each test with an empty document', () => {
    // Fails without the cleanup in setup.ts: the paragraph from the test
    // above would still be mounted and this would find it.
    expect(screen.queryByText('Hello Arcadia')).toBeNull()
  })
})

/**
 * Unmounts what a test rendered.
 *
 * Testing Library only registers this itself when vitest runs with
 * `globals: true`, which this project does not. Without it every render
 * stacks up in the same document and `getByRole` starts finding the
 * previous test's buttons.
 */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

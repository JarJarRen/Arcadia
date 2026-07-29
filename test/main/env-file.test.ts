import { describe, expect, it } from 'vitest'
import { envFileCandidates } from '@main/env-file'

describe('envFileCandidates', () => {
  it('looks in the working directory first when running from the repo', () => {
    // How it has always worked in development: `npm run dev` from the
    // checkout, with .env beside package.json.
    const paths = envFileCandidates({
      cwd: 'C:\\repo\\arcadia',
      userData: 'C:\\Users\\x\\AppData\\Roaming\\arcadia'
    })
    expect(paths[0]).toBe('C:\\repo\\arcadia\\.env')
  })

  it('also looks beside the database', () => {
    // The installed app has no repo to sit in, and its working directory is
    // wherever the shortcut happened to point. userData is the one place
    // that is always writable, always the same, and already holds
    // arcadia.db — so it is where a user can reasonably be told to put a
    // key.
    const paths = envFileCandidates({
      cwd: 'C:\\Program Files\\Arcadia',
      userData: 'C:\\Users\\x\\AppData\\Roaming\\arcadia'
    })
    expect(paths).toContain('C:\\Users\\x\\AppData\\Roaming\\arcadia\\.env')
  })

  it('offers each location once', () => {
    // Running from the userData directory would otherwise produce the same
    // path twice and load it twice.
    const same = 'C:\\Users\\x\\AppData\\Roaming\\arcadia'
    const paths = envFileCandidates({ cwd: same, userData: same })
    expect(paths).toHaveLength(1)
  })

  it('copes with userData being unknown', () => {
    const paths = envFileCandidates({ cwd: 'C:\\repo' })
    expect(paths).toEqual(['C:\\repo\\.env'])
  })
})

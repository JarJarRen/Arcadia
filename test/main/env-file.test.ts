import { describe, expect, it } from 'vitest'
import {
  applyEnvValues,
  envFileCandidates,
  envTargetPath,
  envValueIsWritable,
  parseEnvFile
} from '@main/env-file'

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

/** A file as it actually looks once copied from .env.example and filled in. */
const REAL_FILE = [
  '# Template. Copy to `.env` and fill in:',
  '',
  '# Steam Web API — the owned library and playtime.',
  'STEAM_WEB_API_KEY=ABC123',
  '',
  '# Optional.',
  'STEAM_ID64=',
  'STEAMGRIDDB_API_KEY=grid-key'
].join('\n')

describe('parseEnvFile', () => {
  it('reads the values', () => {
    const values = parseEnvFile(REAL_FILE)
    expect(values.STEAM_WEB_API_KEY).toBe('ABC123')
    expect(values.STEAMGRIDDB_API_KEY).toBe('grid-key')
  })

  it('reads an empty value as empty rather than missing', () => {
    expect(parseEnvFile(REAL_FILE).STEAM_ID64).toBe('')
  })

  it('ignores comments, including one that looks like an assignment', () => {
    expect(parseEnvFile('# STEAM_ID64=76561198000000000').STEAM_ID64).toBeUndefined()
  })

  it('ignores blank lines and surrounding whitespace', () => {
    expect(parseEnvFile('\n  STEAM_ID64 = 7656  \n\n').STEAM_ID64).toBe('7656')
  })

  it('keeps a value containing an equals sign whole', () => {
    // Base64-ish keys end in '='; splitting on every one would truncate them.
    expect(parseEnvFile('KEY=a=b=c').KEY).toBe('a=b=c')
  })

  it('reads the marker like any other key', () => {
    expect(parseEnvFile('ENV_CONFIG_DONE=true').ENV_CONFIG_DONE).toBe('true')
  })

  it('returns nothing for an empty file', () => {
    expect(parseEnvFile('')).toEqual({})
  })
})

describe('applyEnvValues', () => {
  it('replaces a value where it stands', () => {
    const next = applyEnvValues(REAL_FILE, { STEAM_WEB_API_KEY: 'NEW' })
    expect(parseEnvFile(next).STEAM_WEB_API_KEY).toBe('NEW')
    expect(next.split('\n')[3]).toBe('STEAM_WEB_API_KEY=NEW')
  })

  it('keeps the comments', () => {
    // They are the documentation: the URLs for obtaining the keys live
    // nowhere else once .env.example has been copied.
    const next = applyEnvValues(REAL_FILE, { STEAM_ID64: '7656' })
    expect(next).toContain('# Steam Web API — the owned library and playtime.')
    expect(next).toContain('# Optional.')
  })

  it('leaves keys it was not asked about alone', () => {
    const next = applyEnvValues(REAL_FILE, { STEAM_ID64: '7656' })
    expect(parseEnvFile(next).STEAMGRIDDB_API_KEY).toBe('grid-key')
  })

  it('leaves a variable it knows nothing about alone', () => {
    const next = applyEnvValues('SOMETHING_ELSE=keep\nSTEAM_ID64=', { STEAM_ID64: '7656' })
    expect(next).toContain('SOMETHING_ELSE=keep')
  })

  it('appends a key the file does not have yet', () => {
    const next = applyEnvValues(REAL_FILE, { ENV_CONFIG_DONE: 'true' })
    expect(parseEnvFile(next).ENV_CONFIG_DONE).toBe('true')
    expect(next).toContain('# Steam Web API — the owned library and playtime.')
  })

  it('writes into an empty file', () => {
    // The case on a fresh install: no .env exists at all.
    const next = applyEnvValues('', { STEAM_ID64: '7656', ENV_CONFIG_DONE: 'true' })
    expect(parseEnvFile(next)).toEqual({ STEAM_ID64: '7656', ENV_CONFIG_DONE: 'true' })
  })

  it('ends the file with a single newline', () => {
    const next = applyEnvValues(REAL_FILE, { ENV_CONFIG_DONE: 'true' })
    expect(next.endsWith('\n')).toBe(true)
    expect(next.endsWith('\n\n')).toBe(false)
  })

  it('clears a value that is emptied', () => {
    expect(parseEnvFile(applyEnvValues(REAL_FILE, { STEAM_WEB_API_KEY: '' }))).toHaveProperty(
      'STEAM_WEB_API_KEY',
      ''
    )
  })

  it('changes nothing when given what the file already says', () => {
    expect(applyEnvValues(REAL_FILE, { STEAM_WEB_API_KEY: 'ABC123' })).toBe(REAL_FILE + '\n')
  })

  it('refuses a value carrying a line break', () => {
    // Written out, the second line would become a variable of its own —
    // arbitrary settings injected through a text field.
    expect(() => applyEnvValues(REAL_FILE, { STEAM_ID64: '7656\nSTEAM_WEB_API_KEY=stolen' })).toThrow()
  })
})

describe('envValueIsWritable', () => {
  it('accepts an ordinary key', () => {
    expect(envValueIsWritable('B7A1F0C9E2D34A5B8C6D7E8F90A1B2C3')).toBe(true)
  })

  it('accepts an empty value', () => {
    expect(envValueIsWritable('')).toBe(true)
  })

  it('rejects a line break in either form', () => {
    expect(envValueIsWritable('a\nb')).toBe(false)
    expect(envValueIsWritable('a\r\nb')).toBe(false)
  })

  it('rejects something far too long to be a key', () => {
    expect(envValueIsWritable('x'.repeat(1000))).toBe(false)
  })
})

describe('envTargetPath', () => {
  const CWD = 'C:\\repo\\arcadia\\.env'
  const USER = 'C:\\Users\\x\\AppData\\Roaming\\arcadia\\.env'

  it('writes to the file the app would actually read', () => {
    // dotenv loads the checkout's .env first, so writing to userData while
    // that one exists would leave the saved keys shadowed and unused.
    expect(envTargetPath([CWD, USER], (path) => path === CWD)).toBe(CWD)
  })

  it('writes beside the database when the checkout has no .env', () => {
    expect(envTargetPath([CWD, USER], (path) => path === USER)).toBe(USER)
  })

  it('creates the one beside the database when neither exists', () => {
    // userData rather than the working directory: an installed copy sits in
    // Program Files, which is not writable without administrator rights.
    expect(envTargetPath([CWD, USER], () => false)).toBe(USER)
  })

  it('falls back to the only candidate there is', () => {
    expect(envTargetPath([CWD], () => false)).toBe(CWD)
  })
})

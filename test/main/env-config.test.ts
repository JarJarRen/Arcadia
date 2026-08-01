import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEnvConfig, saveEnvConfig } from '@main/env-config'
import { emptyEnvConfig } from '@shared/env-config'

/**
 * Reading and writing the real file, against a real directory.
 *
 * The parsing itself is covered in env-file.test.ts; what is checked here is
 * the part that touches the disk — which file of the candidates is chosen,
 * what happens when none exists, and whether a save is reported as a change.
 */
let directory: string
let checkout: string
let userData: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'arcadia-env-'))
  checkout = join(directory, 'checkout.env')
  userData = join(directory, 'userdata.env')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const candidates = (): string[] => [checkout, userData]

describe('readEnvConfig', () => {
  it('reports nothing configured when no file exists', () => {
    const state = readEnvConfig(candidates())
    expect(state.done).toBe(false)
    expect(state.values).toEqual(emptyEnvConfig())
  })

  it('names the file it would write to', () => {
    // Shown in the dialog: without it there is no way to tell which of the
    // two locations is being edited.
    expect(readEnvConfig(candidates()).path).toBe(userData)
  })

  it('prefills from the file the app actually loads', async () => {
    await writeFile(checkout, 'STEAM_WEB_API_KEY=from-checkout\n')
    await writeFile(userData, 'STEAM_WEB_API_KEY=from-userdata\n')
    // dotenv loads the checkout first and `override: false` makes it win, so
    // that is the value in force and the one the screen has to show.
    expect(readEnvConfig(candidates()).values.STEAM_WEB_API_KEY).toBe('from-checkout')
  })

  it('reports the marker', async () => {
    await writeFile(userData, 'ENV_CONFIG_DONE=true\n')
    expect(readEnvConfig(candidates()).done).toBe(true)
  })

  it('treats any other value of the marker as unanswered', async () => {
    await writeFile(userData, 'ENV_CONFIG_DONE=maybe\n')
    expect(readEnvConfig(candidates()).done).toBe(false)
  })

  it('ignores keys that are not settings', async () => {
    await writeFile(userData, 'SOMETHING_ELSE=x\nSTEAM_ID64=7656\n')
    expect(readEnvConfig(candidates()).values).toEqual({
      ...emptyEnvConfig(),
      STEAM_ID64: '7656'
    })
  })
})

describe('saveEnvConfig', () => {
  it('creates the file beside the database when none exists', async () => {
    const result = saveEnvConfig(candidates(), {
      ...emptyEnvConfig(),
      STEAM_WEB_API_KEY: 'NEW'
    })
    expect(result.path).toBe(userData)
    expect(await readFile(userData, 'utf8')).toContain('STEAM_WEB_API_KEY=NEW')
  })

  it('always writes the marker', async () => {
    saveEnvConfig(candidates(), emptyEnvConfig())
    expect(await readFile(userData, 'utf8')).toContain('ENV_CONFIG_DONE=true')
  })

  it('writes the marker when skipping without touching the keys', async () => {
    await writeFile(checkout, '# comment\nSTEAM_WEB_API_KEY=KEEP\n')
    saveEnvConfig(candidates(), undefined)
    const written = await readFile(checkout, 'utf8')
    expect(written).toContain('STEAM_WEB_API_KEY=KEEP')
    expect(written).toContain('ENV_CONFIG_DONE=true')
  })

  it('reports a changed value as a change', async () => {
    await writeFile(checkout, 'STEAM_WEB_API_KEY=OLD\n')
    expect(
      saveEnvConfig(candidates(), { ...emptyEnvConfig(), STEAM_WEB_API_KEY: 'NEW' }).changed
    ).toBe(true)
  })

  it('reports saving the same values as no change', async () => {
    // The app restarts only for a real change; re-saving what is already
    // there would otherwise cost a restart for nothing.
    await writeFile(checkout, 'STEAM_WEB_API_KEY=SAME\n')
    expect(
      saveEnvConfig(candidates(), { ...emptyEnvConfig(), STEAM_WEB_API_KEY: 'SAME' }).changed
    ).toBe(false)
  })

  it('reports skipping as no change', async () => {
    await writeFile(checkout, 'STEAM_WEB_API_KEY=SAME\n')
    expect(saveEnvConfig(candidates(), undefined).changed).toBe(false)
  })

  it('keeps the comments of the file it edits', async () => {
    await writeFile(checkout, '# Free from https://steamcommunity.com/dev/apikey\nSTEAM_WEB_API_KEY=\n')
    saveEnvConfig(candidates(), { ...emptyEnvConfig(), STEAM_WEB_API_KEY: 'NEW' })
    expect(await readFile(checkout, 'utf8')).toContain(
      '# Free from https://steamcommunity.com/dev/apikey'
    )
  })

  it('trims what was typed', async () => {
    saveEnvConfig(candidates(), { ...emptyEnvConfig(), STEAM_ID64: '  7656  ' })
    expect(readEnvConfig(candidates()).values.STEAM_ID64).toBe('7656')
  })

  it('refuses a value with a line break instead of writing it', async () => {
    await writeFile(userData, 'STEAM_ID64=\n')
    expect(() =>
      saveEnvConfig(candidates(), {
        ...emptyEnvConfig(),
        STEAM_ID64: '7656\nSTEAM_WEB_API_KEY=stolen'
      })
    ).toThrow()
    expect(await readFile(userData, 'utf8')).not.toContain('stolen')
  })
})

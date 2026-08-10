import { describe, expect, it } from 'vitest'
import {
  buildHardwareString,
  HARDWARE_COMMAND,
  HARDWARE_FIELDS,
  parseHardwareOutput,
  readHardwareString
} from '@main/stores/ea/hardware'
import { RUNS_SUBPROCESSES } from '../../subprocess'

const OUTPUT = [
  'baseBoardManufacturer=Micro-Star International Co., Ltd.',
  'baseBoardSerial=BB-1',
  'biosManufacturer=American Megatrends International, LLC.',
  'biosSerial=BIOS-1',
  'volumeSerial=7CB7433E',
  'videoPnpId=PCI\\VEN_1002&DEV_744C',
  'cpuManufacturer=AuthenticAMD',
  'cpuId=CPU-1',
  'cpuName=AMD Ryzen 7 5800X'
].join('\r\n')

describe('EA hardware fingerprint', () => {
  it('parses the key=value lines', () => {
    const values = parseHardwareOutput(OUTPUT)
    expect(values.baseBoardManufacturer).toBe('Micro-Star International Co., Ltd.')
    expect(values.videoPnpId).toBe('PCI\\VEN_1002&DEV_744C')
    expect(values.cpuName).toBe('AMD Ryzen 7 5800X')
  })

  it('keeps the padding WMI puts on the processor name', () => {
    // Win32_Processor.Name arrives with trailing spaces, and EA hashes the
    // property exactly as WMI hands it over. Trimming produces a key that is
    // wrong with nothing to show for it: every store decrypts to noise and the
    // library merely looks empty. Verified against the real store files.
    const values = parseHardwareOutput('cpuName=AMD Ryzen 9 5950X 16-Core Processor            \r\n')
    expect(values.cpuName).toBe('AMD Ryzen 9 5950X 16-Core Processor            ')
    expect(buildHardwareString(values)).toContain('Processor            ;')
  })

  it('ignores lines that are not fields', () => {
    // PowerShell writes warnings and blank lines to the same stream; none of
    // them may shift a field.
    const values = parseHardwareOutput(`WARNING: something\r\n\r\n${OUTPUT}\r\nnonsense=1`)
    expect(Object.keys(values)).toHaveLength(9)
  })

  it('joins the fields in EA’s order and closes with a separator', () => {
    // The trailing semicolon is not decoration: without it the derived key
    // decrypts nothing. Measured against EA's own install queue.
    const joined = buildHardwareString(parseHardwareOutput(OUTPUT))
    expect(joined.endsWith(';')).toBe(true)
    expect(joined.split(';')).toHaveLength(10)
    expect(joined.startsWith('Micro-Star International Co., Ltd.;BB-1;')).toBe(true)
  })

  it('keeps a missing field as an empty slot', () => {
    // Dropping it would shift every later field and change the key, so an
    // absent WMI property has to stay an empty string.
    const joined = buildHardwareString({ baseBoardManufacturer: 'ACME', cpuName: 'CPU' })
    expect(joined).toBe('ACME;;;;;;;;CPU;')
  })

  it('asks PowerShell rather than wmic', () => {
    // wmic is gone from current Windows 11 installs.
    expect(HARDWARE_COMMAND).toMatch(/powershell/i)
    expect(HARDWARE_COMMAND).not.toMatch(/wmic/i)
    // Single quotes only inside: the whole command is handed to cmd.exe in
    // double quotes, and an inner double quote would end it early.
    expect(HARDWARE_COMMAND.slice(HARDWARE_COMMAND.indexOf('"') + 1, -1)).not.toContain('"')
  })

  it('reads the string through the injected runner', async () => {
    expect(await readHardwareString(async () => OUTPUT)).toBe(
      buildHardwareString(parseHardwareOutput(OUTPUT))
    )
  })

  it('returns undefined when the command fails', async () => {
    // Not Windows, no PowerShell, WMI disabled — all the same answer, and all
    // of them mean "no owned games" rather than a failed scan.
    expect(
      await readHardwareString(async () => {
        throw new Error('not found')
      })
    ).toBeUndefined()
  })

  it('returns undefined when nothing came back', async () => {
    // A string built from nothing would still produce a key, and that key
    // would fail indistinguishably from EA having changed the format.
    expect(await readHardwareString(async () => '')).toBeUndefined()
    expect(await readHardwareString(async () => 'baseBoardManufacturer=')).toBeUndefined()
  })

  it.skipIf(!RUNS_SUBPROCESSES || process.platform !== 'win32')('reads the string through the real PowerShell/WMI runner by default', async () => {
    // The only test in this file that exercises `defaultExec` rather than
    // an injected fake — it runs the real HARDWARE_COMMAND against this
    // machine's own WMI data. The exact values are unverifiable (they
    // depend on the machine this runs on), so this only pins the shape: a
    // real fingerprint comes back, in the format buildHardwareString
    // produces.
    //
    // Skipped unless `--mode full`: PowerShell opens a console window that
    // no `windowsHide` can suppress. `npm run test:coverage` runs it, which
    // is what Windows CI uses. See test/subprocess.ts.
    //
    // And Windows-only on top of that. `RUNS_SUBPROCESSES` says whether a
    // real process may be started, not whether this particular one exists:
    // elsewhere there is no PowerShell, `readHardwareString` answers
    // `undefined` exactly as documented, and the assertions below would
    // report a broken fingerprint on a machine that simply is not Windows.
    const value = await readHardwareString()
    expect(value).toBeDefined()
    expect(value?.endsWith(';')).toBe(true)
    expect(value?.split(';')).toHaveLength(HARDWARE_FIELDS.length + 1)
  }, 15000)
})

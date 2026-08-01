import { describe, expect, it } from 'vitest'
import {
  buildHardwareString,
  HARDWARE_COMMAND,
  parseHardwareOutput,
  readHardwareString
} from '@main/stores/ea/hardware'

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
})

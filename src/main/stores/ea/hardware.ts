import type { ExecFn } from '@main/platform/registry'

/**
 * The hardware string EA derives its encryption key from.
 *
 * Nine WMI properties in a fixed order, joined with semicolons and closed
 * with one — the trailing separator is not decoration, the key does not match
 * without it. Verified on the development machine: with the trailing
 * semicolon EA's install queue decrypts to valid JSON, without it the same
 * file decrypts to noise.
 *
 * `wmic` is deliberately not used. It is deprecated and no longer present on
 * current Windows 11 installs; `Get-CimInstance` is the supported route and
 * returns the same values.
 */

/** The fields, in the order EA concatenates them. */
export const HARDWARE_FIELDS = [
  'baseBoardManufacturer',
  'baseBoardSerial',
  'biosManufacturer',
  'biosSerial',
  'volumeSerial',
  'videoPnpId',
  'cpuManufacturer',
  'cpuId',
  'cpuName'
] as const

export type HardwareField = (typeof HARDWARE_FIELDS)[number]
export type HardwareValues = Partial<Record<HardwareField, string>>

/**
 * One PowerShell call for all nine values.
 *
 * Written with single quotes only: the whole thing is handed to `cmd.exe` in
 * double quotes, and an inner double quote would end the argument early.
 *
 * `-First 1` on the video controller and the processor mirrors what EA reads.
 * A machine with two GPUs could therefore disagree with EA about which one
 * counts — unverifiable here with one GPU, and the failure mode is a wrong
 * key, which degrades to "no owned games" rather than to bad data.
 */
export const HARDWARE_COMMAND =
  'powershell -NoProfile -NonInteractive -Command ' +
  '"$ErrorActionPreference=\'SilentlyContinue\'; ' +
  '$b=Get-CimInstance Win32_BaseBoard | Select-Object -First 1; ' +
  '$i=Get-CimInstance Win32_BIOS | Select-Object -First 1; ' +
  '$v=Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -eq \'C:\' } | Select-Object -First 1; ' +
  '$g=Get-CimInstance Win32_VideoController | Select-Object -First 1; ' +
  '$c=Get-CimInstance Win32_Processor | Select-Object -First 1; ' +
  "Write-Output ('baseBoardManufacturer=' + $b.Manufacturer) " +
  "('baseBoardSerial=' + $b.SerialNumber) " +
  "('biosManufacturer=' + $i.Manufacturer) " +
  "('biosSerial=' + $i.SerialNumber) " +
  "('volumeSerial=' + $v.VolumeSerialNumber) " +
  "('videoPnpId=' + $g.PNPDeviceID) " +
  "('cpuManufacturer=' + $c.Manufacturer) " +
  "('cpuId=' + $c.ProcessorId) " +
  "('cpuName=' + $c.Name)\""

/**
 * Parses the `key=value` lines the command prints.
 *
 * **The value is taken verbatim, never trimmed.** WMI pads `Win32_Processor`
 * `Name` with trailing spaces — "AMD Ryzen 9 5950X 16-Core Processor" arrives
 * with twelve of them — and EA hashes the property exactly as WMI hands it
 * over. Trimming produces a key that is wrong in a way nothing reports: every
 * store then decrypts to noise and the library simply looks empty. That cost
 * an afternoon once; the test below pins it.
 *
 * The line terminator is not part of the value: the split already removed it.
 */
export function parseHardwareOutput(output: string): HardwareValues {
  const values: HardwareValues = {}
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    if (!(HARDWARE_FIELDS as readonly string[]).includes(key)) continue
    values[key as HardwareField] = line.slice(separator + 1)
  }
  return values
}

/**
 * Joins the values the way EA does.
 *
 * A field WMI does not answer for becomes an empty string rather than being
 * skipped: EA concatenates the property whatever it holds, so dropping it
 * would shift every later field and change the key.
 */
export function buildHardwareString(values: HardwareValues): string {
  return HARDWARE_FIELDS.map((field) => values[field] ?? '').join(';') + ';'
}

/**
 * Reads the hardware string, or `undefined` when it cannot be had.
 *
 * `undefined` rather than a partial string on purpose: a string built from
 * nothing would still produce a key, that key would decrypt nothing, and the
 * cause would be indistinguishable from EA having changed the format.
 */
export async function readHardwareString(exec?: ExecFn): Promise<string | undefined> {
  let output: string
  try {
    output = await (exec === undefined ? defaultExec(HARDWARE_COMMAND) : exec(HARDWARE_COMMAND))
  } catch {
    // No PowerShell, no WMI, not Windows at all — all the same answer here.
    return undefined
  }

  const values = parseHardwareOutput(output)
  // At least one real value: an empty result means the call did not do what
  // it was supposed to, and guessing on from there is worse than stopping.
  if (Object.values(values).every((value) => value === undefined || value === '')) return undefined
  return buildHardwareString(values)
}

/**
 * The default runner.
 *
 * Imported lazily so this module stays loadable — and testable — on a system
 * where `node:child_process` has nothing useful to do.
 */
async function defaultExec(command: string): Promise<string> {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { stdout } = await promisify(exec)(command, { windowsHide: true })
  return stdout
}

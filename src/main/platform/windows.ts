import { spawn as spawnProcess } from 'node:child_process'
import { WINDOW_AGENT_SCRIPT } from './window-agent'

/** Arcadia's rectangle, in physical pixels. */
export interface AgentTarget {
  x: number
  y: number
  width: number
  height: number
}

export interface AgentRequest {
  /** Executable the agent starts instead of handing the URI to the shell. */
  exe: string
  args: string[]
  /** Image names whose windows count as the store's, with or without .exe. */
  processNames: string[]
  /** Exact titles that are never the dialog. */
  ignoreTitles: string[]
  target: AgentTarget
  /** Arcadia's window handle, decimal. */
  owner: string
  timeoutMs: number
  settleMs: number
  /** Height to grow a too-short dialog to. 0 means do not resize. */
  minHeight: number
}

export type AgentEvent =
  | { event: 'started'; ok: boolean; reason?: string; detail?: string }
  | { event: 'placed'; ok: boolean; reason?: string; hwnd?: number }
  | { event: 'done' }

export interface PlacedEvent {
  ok: boolean
  reason?: string
  hwnd?: number
}

/**
 * The agent process, reduced to what the caller needs.
 *
 * An interface rather than a `ChildProcess` so a test can drive the output
 * line by line without a real process — which on a build machine without
 * PowerShell there would not be.
 */
export interface AgentProcess {
  onLine: (handler: (line: string) => void) => void
  onExit: (handler: () => void) => void
  kill: () => void
}

export type SpawnFn = (env: Record<string, string>, script: string) => AgentProcess

export interface AgentHandle {
  /** Whether the store's executable was launched at all. */
  started: Promise<boolean>
  /**
   * The detail behind a failed start — the spawn exception's message, when
   * the agent reported one. Separate from `started` so that promise can stay
   * the plain boolean the bridge already branches on.
   */
  startedDetail: Promise<string | undefined>
  /** How the placement ended, or undefined if the agent died first. */
  placed: Promise<PlacedEvent | undefined>
  cancel: () => void
}

const POWERSHELL = 'powershell.exe'

/**
 * Windows PowerShell rather than pwsh: it is the one that is always
 * present. `-Command -` reads the script from stdin, which is what lets
 * the script travel as a string instead of as a packaged file.
 */
const POWERSHELL_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  '-'
]

export function buildAgentEnv(request: AgentRequest): Record<string, string> {
  return {
    ARCADIA_AGENT_EXE: request.exe,
    ARCADIA_AGENT_ARGS: JSON.stringify(request.args),
    // Get-Process reports "steam", not "steam.exe". Normalising here keeps
    // the rule in TypeScript, where it can be tested.
    ARCADIA_AGENT_PROCESSES: JSON.stringify(
      request.processNames.map((name) => name.replace(/\.exe$/i, '').toLowerCase())
    ),
    ARCADIA_AGENT_IGNORE_TITLES: JSON.stringify(request.ignoreTitles),
    ARCADIA_AGENT_TARGET: JSON.stringify(request.target),
    ARCADIA_AGENT_OWNER: request.owner,
    ARCADIA_AGENT_TIMEOUT_MS: String(request.timeoutMs),
    ARCADIA_AGENT_SETTLE_MS: String(request.settleMs),
    ARCADIA_AGENT_MIN_HEIGHT: String(request.minHeight)
  }
}

export function parseAgentLine(line: string): AgentEvent | undefined {
  const text = line.trim()
  if (text === '') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A PowerShell warning, a partial line, anything else on the pipe.
    // The agent's own lines are always complete JSON objects, so silence
    // is the right answer for everything that is not.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined

  const record = parsed as Record<string, unknown>
  // Absent counts as false, never as true: a missing ok must not be read
  // as a success the agent never claimed.
  const ok = record.ok === true
  const reason = typeof record.reason === 'string' ? record.reason : undefined
  const detail = typeof record.detail === 'string' ? record.detail : undefined

  switch (record.event) {
    case 'started':
      return { event: 'started', ok, reason, detail }
    case 'placed':
      return {
        event: 'placed',
        ok,
        reason,
        hwnd: typeof record.hwnd === 'number' ? record.hwnd : undefined
      }
    case 'done':
      return { event: 'done' }
    default:
      return undefined
  }
}

/**
 * Splits a chunk of stdout into the lines that are finished.
 *
 * Returns those lines and whatever followed the last newline, which
 * belongs to the next chunk. Separate from the spawn wrapper because this
 * is the part with something to get wrong — a dropped remainder loses
 * exactly the event the bridge is waiting for.
 */
export function consumeLines(
  buffer: string,
  chunk: string
): { lines: string[]; rest: string } {
  const parts = (buffer + chunk).split(/\r?\n/)
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}

/**
 * Reads a native window handle out of Electron's buffer.
 *
 * Decimal, and via BigInt: a handle above 2^53 read as a Number would
 * round, and the script casts this string straight to IntPtr. 64-bit
 * Windows hands over eight bytes; the narrower read is there for any other
 * shape rather than as a supported target.
 */
export function decodeWindowHandle(handle: Buffer): string {
  return handle.length >= 8
    ? handle.readBigUInt64LE(0).toString()
    : String(handle.readUInt32LE(0))
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const defaultSpawn: SpawnFn = (env, script) => {
  const child = spawnProcess(POWERSHELL, POWERSHELL_ARGS, {
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  })

  const lineHandlers: Array<(line: string) => void> = []
  const exitHandlers: Array<() => void> = []
  let finished = false
  const finish = (): void => {
    // 'error' and 'close' can both arrive for one failed spawn. The caller
    // treats exit as "nothing more is coming", which must be said once.
    if (finished) return
    finished = true
    for (const handler of exitHandlers) handler()
  }

  let buffer = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    const { lines, rest } = consumeLines(buffer, chunk)
    buffer = rest
    for (const line of lines) {
      for (const handler of lineHandlers) handler(line)
    }
  })

  // Without an 'error' listener Node promotes a failed spawn to an
  // uncaught exception and takes the whole app down with it.
  child.on('error', finish)
  child.on('close', finish)

  try {
    child.stdin?.write(script)
    child.stdin?.end()
  } catch {
    // A process that never spawned has no stdin. The 'error' event is
    // already on its way and will report it.
  }

  return {
    onLine: (handler) => lineHandlers.push(handler),
    onExit: (handler) => exitHandlers.push(handler),
    kill: () => child.kill()
  }
}

/**
 * Starts the store through the agent and reports what became of its window.
 *
 * The agent starts the process itself. That is deliberate: the snapshot of
 * existing windows has to be taken before the launch, and doing both in one
 * place removes the need for a conversation between the two processes.
 */
export function runWindowAgent(
  request: AgentRequest,
  spawn: SpawnFn = defaultSpawn
): AgentHandle {
  const child = spawn(buildAgentEnv(request), WINDOW_AGENT_SCRIPT)
  const started = deferred<boolean>()
  const startedDetail = deferred<string | undefined>()
  const placed = deferred<PlacedEvent | undefined>()

  // The 30 s wizard timeout and 5 s settle window are the script's own
  // deadlines, enforced inside its loops — they never get a chance to fire
  // if PowerShell stalls before printing a single line, which a slow or
  // stuck `Add-Type` compile can do. This is the fallback for exactly that:
  // comfortably past every deadline the script enforces on itself, so it
  // only ever catches a genuinely stuck process, never a slow-but-working
  // one.
  const guard = setTimeout(
    () => {
      child.kill()
      // All three are no-ops once settled, exactly as in onExit below.
      started.resolve(false)
      startedDetail.resolve(undefined)
      placed.resolve(undefined)
    },
    request.timeoutMs + request.settleMs + 15_000
  )
  // A pending guard must never keep the Node process open by itself, and
  // under vitest fake timers it must not keep the test run alive either.
  guard.unref?.()

  child.onLine((line) => {
    const event = parseAgentLine(line)
    if (event === undefined) return
    if (event.event === 'started') {
      started.resolve(event.ok)
      startedDetail.resolve(event.detail)
    }
    if (event.event === 'placed') {
      // A placement without a preceding launch cannot happen, but settling
      // both keeps a caller from waiting forever if it ever did.
      started.resolve(true)
      startedDetail.resolve(undefined)
      placed.resolve({ ok: event.ok, reason: event.reason, hwnd: event.hwnd })
    }
  })

  child.onExit(() => {
    // All three are no-ops once settled. An agent that dies before saying
    // anything therefore reports a launch that never happened — which is
    // exactly the signal the caller needs to run the URI itself.
    started.resolve(false)
    startedDetail.resolve(undefined)
    placed.resolve(undefined)
    // The run is over one way or another, so the guard must not outlive it.
    clearTimeout(guard)
  })

  return {
    started: started.promise,
    startedDetail: startedDetail.promise,
    placed: placed.promise,
    cancel: () => child.kill()
  }
}

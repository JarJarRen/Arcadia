import { describe, expect, it, vi } from 'vitest'
import {
  buildAgentEnv,
  consumeLines,
  decodeWindowHandle,
  parseAgentLine,
  runWindowAgent,
  type AgentProcess,
  type AgentRequest
} from '@main/platform/windows'
import { WINDOW_AGENT_SCRIPT } from '@main/platform/window-agent'

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    exe: 'C:\\Steam\\steam.exe',
    args: ['-silent', 'steam://install/440'],
    processNames: ['steam.exe', 'steamwebhelper.exe'],
    ignoreTitles: ['Steam'],
    target: { x: 100, y: 50, width: 1200, height: 800 },
    owner: '65840',
    timeoutMs: 30000,
    guardMs: 5000,
    minHeight: 760,
    ...overrides
  }
}

/** A fake agent process whose output the test writes by hand. */
function fakeProcess(): AgentProcess & {
  emit: (line: string) => void
  exit: () => void
  killed: () => number
} {
  const lines: Array<(line: string) => void> = []
  const exits: Array<() => void> = []
  let kills = 0
  return {
    onLine: (handler) => lines.push(handler),
    onExit: (handler) => exits.push(handler),
    kill: () => {
      kills += 1
    },
    emit: (line) => {
      for (const handler of lines) handler(line)
    },
    exit: () => {
      for (const handler of exits) handler()
    },
    killed: () => kills
  }
}

describe('buildAgentEnv', () => {
  it('strips the extension and lowercases the process names', () => {
    // The agent compares against Get-Process, which reports "steam", not
    // "steam.exe". Normalising here rather than in PowerShell keeps the
    // rule testable.
    const env = buildAgentEnv(request({ processNames: ['Steam.EXE', 'steamwebhelper'] }))
    expect(JSON.parse(env.ARCADIA_AGENT_PROCESSES!)).toEqual(['steam', 'steamwebhelper'])
  })

  it('passes every value the script reads', () => {
    const env = buildAgentEnv(request())
    expect(env.ARCADIA_AGENT_EXE).toBe('C:\\Steam\\steam.exe')
    expect(JSON.parse(env.ARCADIA_AGENT_ARGS!)).toEqual(['-silent', 'steam://install/440'])
    expect(JSON.parse(env.ARCADIA_AGENT_IGNORE_TITLES!)).toEqual(['Steam'])
    expect(JSON.parse(env.ARCADIA_AGENT_TARGET!)).toEqual({
      x: 100,
      y: 50,
      width: 1200,
      height: 800
    })
    expect(env.ARCADIA_AGENT_OWNER).toBe('65840')
    expect(env.ARCADIA_AGENT_TIMEOUT_MS).toBe('30000')
    expect(env.ARCADIA_AGENT_GUARD_MS).toBe('5000')
    expect(env.ARCADIA_AGENT_MIN_HEIGHT).toBe('760')
  })
})

describe('parseAgentLine', () => {
  it('reads the three events', () => {
    expect(parseAgentLine('{"event":"started","ok":true}')).toEqual({
      event: 'started',
      ok: true,
      reason: undefined
    })
    expect(parseAgentLine('{"event":"placed","ok":true,"hwnd":123}')).toEqual({
      event: 'placed',
      ok: true,
      reason: undefined,
      hwnd: 123
    })
    expect(parseAgentLine('{"event":"done"}')).toEqual({ event: 'done' })
  })

  it('keeps the reason of a failure', () => {
    expect(parseAgentLine('{"event":"placed","ok":false,"reason":"timeout"}')).toEqual({
      event: 'placed',
      ok: false,
      reason: 'timeout',
      hwnd: undefined
    })
  })

  it('keeps the detail behind a failed start', () => {
    // The script's catch block reports the exception message under this
    // key. Without it, a spawn failure and every other reason: 'spawn' look
    // identical.
    expect(
      parseAgentLine('{"event":"started","ok":false,"reason":"spawn","detail":"boom"}')
    ).toEqual({
      event: 'started',
      ok: false,
      reason: 'spawn',
      detail: 'boom'
    })
  })

  it('ignores anything that is not one of our events', () => {
    // PowerShell warnings, a half-written line, Steam's own noise. None of
    // it should reach the bridge as an event.
    expect(parseAgentLine('')).toBeUndefined()
    expect(parseAgentLine('   ')).toBeUndefined()
    expect(parseAgentLine('{"event":"pla')).toBeUndefined()
    expect(parseAgentLine('WARNING: something')).toBeUndefined()
    expect(parseAgentLine('null')).toBeUndefined()
    expect(parseAgentLine('[1,2]')).toBeUndefined()
    expect(parseAgentLine('{"event":"unknown"}')).toBeUndefined()
  })

  it('treats a missing ok as not ok rather than as true', () => {
    expect(parseAgentLine('{"event":"started"}')).toEqual({
      event: 'started',
      ok: false,
      reason: undefined
    })
  })
})

describe('consumeLines', () => {
  it('returns the complete lines and keeps the remainder', () => {
    expect(consumeLines('', '{"a":1}\n{"b":2}\n{"c"')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      rest: '{"c"'
    })
  })

  it('joins a line split across two chunks', () => {
    // The event the bridge acts on can straddle a chunk boundary like any
    // other. Losing it would leave the bridge waiting forever.
    const first = consumeLines('', '{"event":"star')
    expect(first.lines).toEqual([])

    const second = consumeLines(first.rest, 'ted","ok":true}\n')
    expect(second.lines).toEqual(['{"event":"started","ok":true}'])
    expect(second.rest).toBe('')
  })

  it('handles CRLF, which is what PowerShell writes', () => {
    expect(consumeLines('', 'one\r\ntwo\r\n')).toEqual({ lines: ['one', 'two'], rest: '' })
  })
})

describe('decodeWindowHandle', () => {
  it('reads the eight bytes 64-bit Windows hands over', () => {
    const handle = Buffer.alloc(8)
    handle.writeBigUInt64LE(65840n, 0)

    expect(decodeWindowHandle(handle)).toBe('65840')
  })

  it('reads a four-byte handle', () => {
    const handle = Buffer.alloc(4)
    handle.writeUInt32LE(4242, 0)

    expect(decodeWindowHandle(handle)).toBe('4242')
  })

  it('keeps a handle too large for a double exact', () => {
    // Read as a Number this would round. The script casts the string to
    // IntPtr, so every digit has to survive.
    const handle = Buffer.alloc(8)
    handle.writeBigUInt64LE(9007199254740993n, 0)

    expect(decodeWindowHandle(handle)).toBe('9007199254740993')
  })
})

describe('runWindowAgent', () => {
  it('resolves started and placed from the agent output', async () => {
    const fake = fakeProcess()
    const handle = runWindowAgent(request(), () => fake)

    fake.emit('{"event":"started","ok":true}')
    expect(await handle.started).toBe(true)
    expect(await handle.startedDetail).toBeUndefined()

    fake.emit('{"event":"placed","ok":true,"hwnd":77}')
    expect(await handle.placed).toEqual({ ok: true, reason: undefined, hwnd: 77 })
  })

  it('reports a launch that never happened when the agent dies silently', async () => {
    // This is the case that would otherwise leave the user with a click
    // that did nothing: the agent is what starts Steam.
    const fake = fakeProcess()
    const handle = runWindowAgent(request(), () => fake)

    fake.exit()

    expect(await handle.started).toBe(false)
    expect(await handle.placed).toBeUndefined()
  })

  it('resolves placed as undefined when the agent dies after starting', async () => {
    const fake = fakeProcess()
    const handle = runWindowAgent(request(), () => fake)

    fake.emit('{"event":"started","ok":true}')
    fake.exit()

    expect(await handle.started).toBe(true)
    expect(await handle.placed).toBeUndefined()
  })

  it('passes the spawn failure through as started:false', async () => {
    const fake = fakeProcess()
    const handle = runWindowAgent(request(), () => fake)

    fake.emit('{"event":"started","ok":false,"reason":"spawn","detail":"boom"}')

    expect(await handle.started).toBe(false)
    // The detail is what turns "spawn failed" into something a developer
    // can actually act on, so it has to survive the trip through the handle.
    expect(await handle.startedDetail).toBe('boom')
  })

  it('kills the process on cancel', () => {
    const fake = fakeProcess()
    const handle = runWindowAgent(request(), () => fake)

    handle.cancel()

    expect(fake.killed()).toBe(1)
  })

  it('resolves both as failed once the guard outlasts a process that never says anything', async () => {
    // A slow or stuck `Add-Type` compile is the realistic cause: PowerShell
    // itself never gets far enough to print a line, so there is no agent
    // output for the bridge to wait on. The script's own 30 s/5 s deadlines
    // live inside its loops and never run — only a guard with its own clock
    // can end this.
    const fake = fakeProcess()
    const req = request()

    // Fake timers first: the guard's setTimeout is scheduled the moment
    // runWindowAgent runs, so it has to exist before that call to be seen.
    vi.useFakeTimers()
    const handle = runWindowAgent(req, () => fake)

    await vi.advanceTimersByTimeAsync(req.timeoutMs + req.guardMs + 15_000)
    vi.useRealTimers()

    expect(await handle.started).toBe(false)
    expect(await handle.placed).toBeUndefined()
    expect(fake.killed()).toBe(1)
  })

  it('does not kill the agent long after placed, once it has proven it is alive', async () => {
    // Before the guard was cleared on `placed`, this was the exact bug: a
    // wizard the user was still using got killed out from under them once
    // the clock the guard was started with ran out, even though the process
    // had already shown it was not stuck.
    const fake = fakeProcess()
    const req = request()

    vi.useFakeTimers()
    const handle = runWindowAgent(req, () => fake)

    fake.emit('{"event":"started","ok":true}')
    fake.emit('{"event":"placed","ok":true,"hwnd":77}')

    await vi.advanceTimersByTimeAsync(req.timeoutMs + req.guardMs + 15_000)
    vi.useRealTimers()

    expect(await handle.started).toBe(true)
    expect(await handle.placed).toEqual({ ok: true, reason: undefined, hwnd: 77 })
    expect(fake.killed()).toBe(0)
  })

  it('hands the built environment and the script to the spawn function', () => {
    const fake = fakeProcess()
    let seenEnv: Record<string, string> | undefined
    let seenScript: string | undefined

    runWindowAgent(request(), (env, script) => {
      seenEnv = env
      seenScript = script
      return fake
    })

    expect(seenEnv?.ARCADIA_AGENT_EXE).toBe('C:\\Steam\\steam.exe')
    expect(seenScript).toBe(WINDOW_AGENT_SCRIPT)
  })
})

describe('runWindowAgent against the real script', () => {
  // Every test above drives the agent through fakeProcess and never once
  // runs the actual PowerShell. That is exactly how the @() bug shipped:
  // the fake always handed over a flat args array, so no unit test ever hit
  // the nested-array shape ConvertFrom-Json actually produces. These run
  // the genuine script through the genuine default spawn, against an
  // executable every Windows machine has, so a regression here throws
  // inside Start-Process for real instead of inside a mock that cannot.
  it.skipIf(process.platform !== 'win32')(
    'starts cmd.exe through the real spawn when there are arguments',
    async () => {
      const handle = runWindowAgent(
        request({ exe: 'cmd.exe', args: ['/c', 'exit'], timeoutMs: 2000, guardMs: 200 })
      )

      expect(await handle.started).toBe(true)
      // Only the launch matters here; no window is ever going to appear for
      // `cmd.exe /c exit`, and waiting for the placement timeout would make
      // this slow for nothing.
      handle.cancel()
    },
    20_000
  )

  it.skipIf(process.platform !== 'win32')(
    'starts cmd.exe through the real spawn when there are no arguments',
    async () => {
      const handle = runWindowAgent(
        request({ exe: 'cmd.exe', args: [], timeoutMs: 2000, guardMs: 200 })
      )

      expect(await handle.started).toBe(true)
      handle.cancel()
    },
    20_000
  )
})

describe('WINDOW_AGENT_SCRIPT', () => {
  it('contains neither a backtick nor an interpolation opener', () => {
    // The script lives inside a TypeScript template literal. A backtick
    // would end the literal and a "${" would start an interpolation —
    // both are ordinary PowerShell, so this is a real trap rather than a
    // theoretical one.
    expect(WINDOW_AGENT_SCRIPT).not.toContain('`')
    expect(WINDOW_AGENT_SCRIPT).not.toContain('${')
  })

  it('reads every variable buildAgentEnv writes', () => {
    for (const name of Object.keys(buildAgentEnv(request()))) {
      expect(WINDOW_AGENT_SCRIPT).toContain(`$env:${name}`)
    }
  })
})

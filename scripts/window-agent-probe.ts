/**
 * Exercises the window agent against Notepad.
 *
 * The agent's real work — enumerating windows, telling a new one from an
 * old one, moving it — needs a live desktop and cannot be asserted in
 * vitest. This is the substitute: run it, watch Notepad open and jump to
 * the given rectangle, and read the events it prints.
 *
 * Run with `npm run probe:agent`. Windows only.
 */
import { runWindowAgent } from '../src/main/platform/windows'

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('Windows only — the agent has nothing to talk to here.')
    return
  }

  const handle = runWindowAgent({
    exe: 'notepad.exe',
    args: [],
    processNames: ['notepad'],
    ignoreTitles: [],
    // A rectangle in the top-left quarter of the primary monitor, so a
    // correctly centred Notepad is obvious at a glance.
    target: { x: 0, y: 0, width: 900, height: 600 },
    // No owner window: MonitorFromWindow then reports the primary monitor,
    // which is what the probe wants anyway.
    owner: '0',
    timeoutMs: 15_000,
    settleMs: 2_000
  })

  console.log('started:', await handle.started)
  console.log('placed:', await handle.placed)
  console.log('Close Notepad by hand when you are done looking at it.')
}

void main()

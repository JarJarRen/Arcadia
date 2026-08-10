/**
 * Whether the tests that start a real process may run.
 *
 * A few tests deliberately shell out for real rather than injecting a stub,
 * because that is the only way to catch what a stub cannot: Electron and Node
 * do not ship the same crypto, and a command that parses fine can still be
 * refused by the shell that runs it.
 *
 * On Windows each one pops a console window. `exec` runs its command through
 * `cmd.exe` and PowerShell opens a console of its own, so `windowsHide` —
 * which every one of those call sites already passes — cannot suppress them.
 * Windows flashing across the screen on every run is a poor trade for a suite
 * that gets run dozens of times a day.
 *
 * So they are skipped unless vitest runs in `--mode full`, which
 * `npm run test:coverage` uses. See `vitest.config.ts` for how that reaches
 * here, and why this does not amount to quietly dropping them.
 */
export const RUNS_SUBPROCESSES = process.env.ARCADIA_SUBPROCESS_TESTS === '1'

/**
 * The window's non-negotiable security settings.
 *
 * They deliberately live in their own, Electron-free file: as data they
 * can be asserted on directly. A test that instead searched `index.ts` for
 * the strings would stay green if somebody added a second, insecure window
 * or left the setting only in a comment — exactly the bug that was in here
 * once before.
 */
export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
} as const

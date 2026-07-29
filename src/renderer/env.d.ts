import type { ArcadiaApi } from '@shared/ipc'

declare global {
  interface Window {
    arcadia: ArcadiaApi
  }
}

export {}

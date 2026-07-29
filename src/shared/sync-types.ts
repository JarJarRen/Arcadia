import type { StoreId } from './types'

export interface StoreScanResult {
  storeId: StoreId
  ok: boolean
  games: number
  error?: string
}

export interface SyncResult {
  stores: StoreScanResult[]
  totalGames: number
}

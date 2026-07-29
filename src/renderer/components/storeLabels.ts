import type { StoreId } from '@shared/types'

/** User-visible store names, in one place rather than three files. */
export const STORE_LABELS: Record<StoreId, string> = {
  steam: 'Steam',
  epic: 'Epic',
  ea: 'EA',
  ubisoft: 'Ubisoft'
}

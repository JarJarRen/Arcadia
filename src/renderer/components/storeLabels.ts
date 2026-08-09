import type { StoreId } from '@shared/types'

/** User-visible store names, in one place rather than three files. */
export const STORE_LABELS: Record<StoreId, string> = {
  steam: 'Steam',
  epic: 'Epic',
  ea: 'EA',
  ubisoft: 'Ubisoft',
  // The short name, because this list feeds a toolbar button that joins two
  // of them. The adapter's own displayName is the full "Microsoft Store",
  // the same split Ubisoft already has against "Ubisoft Connect".
  microsoft: 'Microsoft'
}

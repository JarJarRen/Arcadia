import type { ReactElement } from 'react'
import { t } from '@shared/i18n'
import type { StoreId } from '@shared/types'
import { StoreFilterMenu } from './StoreFilterMenu'

interface Props {
  search: string
  /** The stores to show, ORed. Empty means every store. */
  stores: StoreId[]
  /** The stores switched on in the configuration screen. */
  available: StoreId[]
  onSearchChange: (search: string) => void
  onStoresChange: (stores: StoreId[]) => void
}

/**
 * The search box and the store filter, in that order.
 *
 * One component rather than the same two elements written into two headers,
 * and rendered first by both: the library and the free-games page have to
 * put them in the same place, or the control under the cursor moves when the
 * page changes. Sharing the markup makes that structural rather than a
 * coincidence two files have to keep agreeing on.
 *
 * Only these two are shared. Everything after them in either header is free
 * to differ, which is why the free-games page keeps its own title, chips and
 * refresh without breaking the alignment.
 */
export function FilterControls({
  search,
  stores,
  available,
  onSearchChange,
  onStoresChange
}: Props): ReactElement {
  return (
    <>
      <input
        type="search"
        className="toolbar__search"
        placeholder={t().toolbar.searchPlaceholder}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />

      <StoreFilterMenu stores={stores} available={available} onChange={onStoresChange} />
    </>
  )
}

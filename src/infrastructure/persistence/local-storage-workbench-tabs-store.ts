import {
  parseWorkbenchTabsPayload,
  serializeWorkbenchTabsState,
  type WorkbenchTabsLoadFailure,
  type WorkbenchTabsLoadResult,
} from '@/contracts/workspace/workbench-tabs.runtime-schema'
import type { WorkbenchTabsState } from '@/domain/workspace/workbench-tabs'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface WorkbenchTabsStore {
  load(): WorkbenchTabsLoadResult | WorkbenchTabsLoadFailure
  save(state: WorkbenchTabsState): void
  clear(): void
}

export const WORKBENCH_TABS_STORAGE_KEY = 'cad.workbench.tabs.v2'

export function createLocalStorageWorkbenchTabsStore(
  storage: StorageLike,
  key = WORKBENCH_TABS_STORAGE_KEY,
): WorkbenchTabsStore {
  return {
    load() {
      const serialized = storage.getItem(key)
      if (serialized === null) {
        return { ok: true, state: null }
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(serialized) as unknown
      } catch {
        return {
          ok: false,
          reasonCode: 'invalid-json',
          message: 'Workbench tabs storage did not contain valid JSON.',
        }
      }

      return parseWorkbenchTabsPayload(parsed)
    },
    save(state) {
      storage.setItem(key, JSON.stringify(serializeWorkbenchTabsState(state)))
    },
    clear() {
      storage.removeItem(key)
    },
  }
}

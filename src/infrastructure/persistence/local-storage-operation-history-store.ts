import type { ModelingOperationHistoryPayload } from '@/contracts/modeling/operation-history'
import { validateOperationHistoryPayload } from '@/contracts/modeling/operation-history'
import type { OperationHistoryStore, StorageLike } from '@/domain/modeling/modeling-history-persistence'

const MODELING_OPERATION_HISTORY_STORAGE_KEY = 'cad.modeling.operationHistory.v1'

export function createLocalStorageOperationHistoryStore(
  storage: StorageLike,
  key = MODELING_OPERATION_HISTORY_STORAGE_KEY,
): OperationHistoryStore {
  return {
    load() {
      const serialized = storage.getItem(key)

      if (serialized === null) {
        return { ok: true, payload: null }
      }

      try {
        return validateOperationHistoryPayload(JSON.parse(serialized) as unknown)
      } catch {
        return {
          ok: false,
          reasonCode: 'invalid-json',
          message: 'Operation history storage did not contain valid JSON.',
        }
      }
    },
    save(payload: ModelingOperationHistoryPayload) {
      storage.setItem(key, JSON.stringify(payload))
    },
    clear() {
      storage.removeItem(key)
    },
  }
}

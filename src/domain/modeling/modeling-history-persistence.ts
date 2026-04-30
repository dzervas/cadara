import {
  createEmptyOperationHistory,
  validateOperationHistoryPayload,
  type ModelingOperationHistoryPayload,
  type OperationHistoryValidationResult,
} from '@/contracts/modeling/operation-history'
import type { DocumentId } from '@/contracts/shared/ids'

export const MODELING_OPERATION_HISTORY_STORAGE_KEY = 'cad.modeling.operationHistory.v1'

export interface OperationHistoryStore {
  load(): OperationHistoryValidationResult | { ok: true; payload: null }
  save(payload: ModelingOperationHistoryPayload): void
  clear(): void
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function createMemoryOperationHistoryStore(
  initialPayload: ModelingOperationHistoryPayload | null = null,
): OperationHistoryStore & { readonly savedPayloads: ModelingOperationHistoryPayload[] } {
  let payload = initialPayload ? structuredClone(initialPayload) : null
  const savedPayloads: ModelingOperationHistoryPayload[] = []

  return {
    savedPayloads,
    load() {
      if (!payload) {
        return { ok: true, payload: null }
      }

      return validateOperationHistoryPayload(structuredClone(payload))
    },
    save(nextPayload) {
      payload = structuredClone(nextPayload)
      savedPayloads.push(structuredClone(nextPayload))
    },
    clear() {
      payload = null
    },
  }
}

export function loadOrCreateOperationHistory(
  store: OperationHistoryStore | null,
  documentId: DocumentId,
): OperationHistoryValidationResult {
  if (!store) {
    return {
      ok: true,
      payload: createEmptyOperationHistory(documentId),
    }
  }

  const result = store.load()
  if (!result.ok) {
    return result
  }

  return {
    ok: true,
    payload: result.payload ?? createEmptyOperationHistory(documentId),
  }
}

export { createLocalStorageOperationHistoryStore } from '@/infrastructure/persistence/local-storage-operation-history-store'

import { type ModelingOperationHistoryPayload, type OperationHistoryValidationResult } from "@/contracts/modeling/operation-history";

export interface OperationHistoryStore {
  load(): OperationHistoryValidationResult | { ok: true; payload: null };
  save(payload: ModelingOperationHistoryPayload): void;
  clear(): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

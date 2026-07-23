import { createHash } from "node:crypto";

/** Cache only immutable, read-only FeatureScript evidence responses. */
export interface ImmutableFeatureScriptEvidenceCache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown): void;
}

/** Minimal injected cache seam for callers that can safely reuse immutable evidence. */
export class InMemoryImmutableFeatureScriptEvidenceCache
  implements ImmutableFeatureScriptEvidenceCache {
  private readonly values = new Map<string, unknown>();

  get(key: string): unknown | undefined {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, structuredClone(value));
  }
}

export interface ImmutableEvidenceCacheKeyInput {
  evidenceSchemaVersion: number;
  baseUrl?: string;
  apiVersion?: string;
  documentId: string;
  microversion: string;
  elementId: string;
  rollbackBarIndex: number;
  script: string;
}

/** Deterministic key that never identifies a mutation or translation request. */
export function immutableFeatureScriptEvidenceCacheKey(
  input: ImmutableEvidenceCacheKeyInput,
): string {
  const requestFingerprint = createHash("sha256").update(input.script).digest("hex");
  return JSON.stringify({
    evidenceSchemaVersion: input.evidenceSchemaVersion,
    baseUrl: input.baseUrl ?? "",
    apiVersion: input.apiVersion ?? "",
    documentId: input.documentId,
    microversion: input.microversion,
    elementId: input.elementId,
    rollbackBarIndex: input.rollbackBarIndex,
    requestFingerprint,
  });
}

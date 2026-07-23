import { expect, test } from "vitest";

import {
  immutableFeatureScriptEvidenceCacheKey,
  InMemoryImmutableFeatureScriptEvidenceCache,
} from "@/cli/commands/onshape-capture/evidence-cache";

const identity = {
  evidenceSchemaVersion: 1,
  baseUrl: "https://cad.onshape.com/api/v10",
  apiVersion: "v10",
  documentId: "doc",
  microversion: "micro-a",
  elementId: "element-a",
  rollbackBarIndex: 2,
  script: "function() {}",
};

test("evidence-cache.spec.ts hits only the exact immutable evidence identity", () => {
  const cache = new InMemoryImmutableFeatureScriptEvidenceCache();
  const key = immutableFeatureScriptEvidenceCacheKey(identity);
  cache.set(key, { result: "cached" });

  expect(cache.get(key)).toEqual({ result: "cached" });
  expect(cache.get(immutableFeatureScriptEvidenceCacheKey({ ...identity, microversion: "micro-b" }))).toBeUndefined();
  expect(cache.get(immutableFeatureScriptEvidenceCacheKey({ ...identity, elementId: "element-b" }))).toBeUndefined();
  expect(cache.get(immutableFeatureScriptEvidenceCacheKey({ ...identity, rollbackBarIndex: 3 }))).toBeUndefined();
  expect(cache.get(immutableFeatureScriptEvidenceCacheKey({ ...identity, script: "function() { return []; }" }))).toBeUndefined();
  expect(cache.get(immutableFeatureScriptEvidenceCacheKey({ ...identity, evidenceSchemaVersion: 2 }))).toBeUndefined();
});

test("evidence-cache.spec.ts isolates cached values from caller mutation", () => {
  const cache = new InMemoryImmutableFeatureScriptEvidenceCache();
  const key = immutableFeatureScriptEvidenceCacheKey(identity);
  const value = { result: { records: ["original"] } };
  cache.set(key, value);
  value.result.records[0] = "mutated-after-set";

  const first = cache.get(key) as { result: { records: string[] } };
  first.result.records[0] = "mutated-after-get";

  expect(cache.get(key)).toEqual({ result: { records: ["original"] } });
});

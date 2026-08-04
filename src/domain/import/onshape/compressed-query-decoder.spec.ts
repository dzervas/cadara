import { expect, test } from "vitest";

import { decodeCompressedQuery } from "@/domain/import/onshape/compressed-query-decoder";

function compressedQuery(payload: string) {
  return `query = qCompressed(1.0,${JSON.stringify(payload)},id);`;
}

// Lane: logic. Seam: the generic qCompressed decoder recognizes Onshape's
// boolean token without assigning topology-producer semantics to it.
test("decodes Onshape's exact T boolean token", () => {
  expect(decodeCompressedQuery(compressedQuery("T"))?.tokens).toEqual([
    { kind: "boolean", value: true },
  ]);
});

test("rejects malformed boolean-token payloads without partial decoding", () => {
  expect(decodeCompressedQuery('query = qCompressed(1.0,"T0",id);')).toBeNull();
  expect(decodeCompressedQuery('query = qCompressed(1.0,"T",wrongId);')).toBeNull();
});

import { expect, test } from "vitest";
import { releaseReplacedOccBakedShapeCache } from "@/domain/modeling/occ/memory";

test("retaining a baked shape cache across a rebuild does not release its body-owned wrappers", () => {
  let deleteCalls = 0;
  const shape = { delete: () => deleteCalls++ };
  const cache = new Map([["asset_rebuilt", [{ shape }]]]);

  releaseReplacedOccBakedShapeCache(cache, cache);

  expect(deleteCalls).toBe(0);
  expect(cache.get("asset_rebuilt")).toEqual([{ shape }]);
});

test("replacing a baked shape cache releases each discarded wrapper once and clears the cache", () => {
  let deleteCalls = 0;
  const shape = { delete: () => deleteCalls++ };
  const discarded = new Map([
    ["asset_first", [{ shape }]],
    ["asset_second", [{ shape }]],
  ]);
  const replacement = new Map([["asset_current", [{ shape: { delete() {} } }]]]);

  releaseReplacedOccBakedShapeCache(discarded, replacement);

  expect(deleteCalls).toBe(1);
  expect(discarded.size).toBe(0);
  expect(replacement.size).toBe(1);
});

import { expect, test } from "vitest";
import {
  releaseOccAuthoringStateObjects,
  releaseReplacedOccBakedShapeCache,
} from "@/domain/modeling/occ/memory";

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

// Lane: logic. Seam: disposing an isolated OCC authoring state releases all
// embind topology wrappers without double-deleting wrappers shared by body/cache views.
test("releasing an OCC authoring state deletes each owned wrapper exactly once", () => {
  const deleteCalls = new Map<string, number>();
  const object = (name: string) => ({
    delete: () => deleteCalls.set(name, (deleteCalls.get(name) ?? 0) + 1),
  });
  const shape = object("shape");
  const face = object("face");
  const edge = object("edge");
  const vertex = object("vertex");
  const body = {
    shape,
    facesById: new Map([["face", face]]),
    edgesById: new Map([["edge", edge]]),
    verticesById: new Map([["vertex", vertex]]),
  };
  const bakedShapeCache = new Map([["asset", [{ shape }]]]);

  releaseOccAuthoringStateObjects({
    baseBodies: [body],
    bodies: [body],
    bakedShapeCache,
  });

  expect(Object.fromEntries(deleteCalls)).toEqual({
    shape: 1,
    face: 1,
    edge: 1,
    vertex: 1,
  });
  expect(bakedShapeCache.size).toBe(0);
});

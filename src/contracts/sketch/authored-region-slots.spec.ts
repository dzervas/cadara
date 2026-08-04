import { expect, test } from "vitest";
import {
  createAuthoredSketchRegionSlots,
  reassociateAuthoredSketchRegionSlots,
} from "@/contracts/sketch/authored-region-slots";
import type { RegionRecord } from "@/contracts/sketch/schema";

function region(
  id: string,
  entities: readonly (string | readonly [string, number])[],
): RegionRecord {
  return {
    regionId: id as never,
    label: id,
    isClosed: true,
    target: { kind: "region", sketchId: "sketch_slots" as never, regionId: id as never },
    sourceSketch: { kind: "sketch", sketchId: "sketch_slots" as never },
    loops: [{
      loopId: `loop_${id}` as never,
      role: "outer",
      orientation: "counterClockwise",
      isClosed: true,
      boundaryPointIds: [],
      segments: entities.map((entry) => {
        const [entityId, sourceSegmentOrdinal] = typeof entry === "string"
          ? [entry, undefined]
          : entry;
        return {
          source: { kind: "entity", entityId: entityId as never },
          startPointId: null,
          endPointId: null,
          ...(sourceSegmentOrdinal === undefined ? {} : { sourceSegmentOrdinal }),
        };
      }),
    }],
  } as RegionRecord;
}

function projectedRegion(
  id: string,
  referenceId: string,
  geometryId: string,
): RegionRecord {
  const result = region(id, ["placeholder"]);
  result.loops[0]!.segments[0]!.source = {
    kind: "projected",
    reference: {
      referenceId: referenceId as never,
      geometryId: geometryId as never,
    },
  };
  return result;
}

test("authored region slots restore an exclusive exact lineage despite ordinal changes", () => {
  const previous = [region("region_authored", [["a", 0], ["b", 1], ["c", 2], ["d", 3]])];
  const current = [region("region_reminted", [["a", 3], ["b", 2], ["c", 1], ["d", 0]])];

  const reassociated = reassociateAuthoredSketchRegionSlots({
    slots: createAuthoredSketchRegionSlots(previous),
    regions: current,
  });

  expect(reassociated[0]?.regionId).toBe("region_authored");
  expect(reassociated[0]?.target.regionId).toBe("region_authored");
  expect(reassociated[0]?.loops[0]?.loopId).toBe("region_loop_region_authored_0");
});

test("authored region slots fail closed for zero or many exact witnesses", () => {
  const previous = [region("region_authored", ["a", "b", "c", "d"])];
  const slots = createAuthoredSketchRegionSlots(previous);

  expect(reassociateAuthoredSketchRegionSlots({
    slots,
    regions: [region("region_changed", ["e", "f", "g", "h"])],
  })[0]?.regionId).toBe("region_changed");

  const duplicate = region("region_duplicate", ["a", "b", "c", "d"]);
  expect(reassociateAuthoredSketchRegionSlots({
    slots,
    regions: [region("region_reminted", ["a", "b", "c", "d"]), duplicate],
  }).map((candidate) => candidate.regionId)).toEqual([
    "region_reminted",
    "region_duplicate",
  ]);
});


test("projected region witnesses encode source ids without delimiter collisions", () => {
  const previous = projectedRegion("region_authored", "a:b", "c");
  const current = projectedRegion("region_reminted", "a", "b:c");

  expect(createAuthoredSketchRegionSlots([previous])[0]?.boundaryWitnesses).not.toEqual(
    createAuthoredSketchRegionSlots([current])[0]?.boundaryWitnesses,
  );
  expect(reassociateAuthoredSketchRegionSlots({
    slots: createAuthoredSketchRegionSlots([previous]),
    regions: [current],
  })[0]?.regionId).toBe("region_reminted");
});

test("region reassociation rewrites every owned loop and leaves failed associations untouched", () => {
  const previous = region("region_authored", ["outer-a", "outer-b"]);
  previous.loops.push({
    ...structuredClone(previous.loops[0]!),
    loopId: "inner_previous" as never,
    role: "inner",
    segments: region("inner", ["inner-a", "inner-b"]).loops[0]!.segments,
  });
  const current = structuredClone(previous);
  current.regionId = "region_reminted" as never;
  current.target = {
    kind: "region",
    sketchId: "sketch_slots" as never,
    regionId: "region_reminted" as never,
  };
  current.loops[0]!.loopId = "outer_reminted" as never;
  current.loops[1]!.loopId = "inner_reminted" as never;

  const [reassociated] = reassociateAuthoredSketchRegionSlots({
    slots: createAuthoredSketchRegionSlots([previous]),
    regions: [current],
  });
  expect(reassociated?.regionId).toBe("region_authored");
  expect(reassociated?.target).toEqual({
    kind: "region",
    sketchId: "sketch_slots",
    regionId: "region_authored",
  });
  expect(reassociated?.sourceSketch).toEqual({ kind: "sketch", sketchId: "sketch_slots" });
  expect(reassociated?.loops.map((loop) => loop.loopId)).toEqual([
    "region_loop_region_authored_0",
    "region_loop_region_authored_1",
  ]);

  const changed = region("region_changed", ["changed-a", "changed-b"]);
  const unchanged = structuredClone(changed);
  expect(reassociateAuthoredSketchRegionSlots({
    slots: createAuthoredSketchRegionSlots([previous]),
    regions: [changed],
  })).toEqual([unchanged]);
});


test("authored region slots use a unique complete witness set when every edge is shared", () => {
  const previous = [
    region("region_authored_ab", ["a", "b"]),
    region("region_authored_ac", ["a", "c"]),
    region("region_authored_bc", ["b", "c"]),
  ];
  const current = [
    region("region_reminted_ab", ["a", "b"]),
    region("region_reminted_ac", ["a", "c"]),
    region("region_reminted_bc", ["b", "c"]),
  ];

  expect(reassociateAuthoredSketchRegionSlots({
    slots: createAuthoredSketchRegionSlots(previous),
    regions: current,
  }).map((candidate) => candidate.regionId)).toEqual([
    "region_authored_ab",
    "region_authored_ac",
    "region_authored_bc",
  ]);
});

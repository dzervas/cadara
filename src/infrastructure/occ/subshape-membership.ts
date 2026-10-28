import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import { releaseOccObjects } from "@/infrastructure/occ/memory";

type OccShape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
/** A TopAbs_ShapeEnum value, as bindings return and accept it. */
type OccShapeType = unknown;
type OccSubshapeMap = InstanceType<
  OpenCascadeInstance["TopTools_IndexedMapOfShape"]
>;

/**
 * Whether a shape has a subshape IsSame `source`, answered from one indexed
 * subshape map per shape and shape type, built on first use and kept until
 * `release`. The map keys by IsSame, so a subshape is in it at most once:
 * membership is exactly "one IsSame match". Mapping a whole result once per
 * lookup made history checks against a many-faced body quadratic.
 */
export function createOccSubshapeMembership(oc: OpenCascadeInstance) {
  const maps = new Map<OccShape, Map<OccShapeType, OccSubshapeMap>>();
  return {
    contains(shape: OccShape, type: OccShapeType, source: OccShape) {
      const byType = maps.get(shape) ?? new Map<OccShapeType, OccSubshapeMap>();
      maps.set(shape, byType);
      let subshapes = byType.get(type);
      if (!subshapes) {
        subshapes = new oc.TopTools_IndexedMapOfShape_1();
        byType.set(type, subshapes);
        oc.TopExp.MapShapes_1(shape, type as never, subshapes);
      }
      return subshapes.FindIndex(source) > 0;
    },
    release() {
      releaseOccObjects(
        [...maps.values()].flatMap((byType) => [...byType.values()]),
      );
    },
  };
}

export type OccSubshapeMembership = ReturnType<
  typeof createOccSubshapeMembership
>;

/** Runs `run` with a fresh membership and releases it afterwards. */
export function withOccSubshapeMembership<T>(
  oc: OpenCascadeInstance,
  run: (membership: OccSubshapeMembership) => T,
) {
  const membership = createOccSubshapeMembership(oc);
  try {
    return run(membership);
  } finally {
    membership.release();
  }
}

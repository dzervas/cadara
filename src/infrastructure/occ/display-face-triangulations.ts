import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import {
  combineOccCleanupError,
  releaseOccObjects,
  type OccDisposable,
} from "@/infrastructure/occ/memory";

type Oc = OpenCascadeInstance;
type Shape = InstanceType<Oc["TopoDS_Shape"]>;
type FaceMap = InstanceType<Oc["TopTools_IndexedMapOfShape_1"]>;
type TriangulationHandle = ReturnType<Oc["BRep_Tool"]["Triangulation"]>;
type PolygonHandle = ReturnType<Oc["BRep_Tool"]["PolygonOnTriangulation_1"]>;
type Location = InstanceType<Oc["TopLoc_Location_1"]>;
type Edge = InstanceType<Oc["TopoDS_Edge"]>;

interface CapturedFaceTriangulation {
  triangulation: TriangulationHandle;
  /** The face's location, which the edge polygons are stored under. */
  location: Location;
  /** Each edge forward, with its polygon (and a seam's reversed one). */
  edges: {
    edge: Edge;
    polygon: PolygonHandle;
    reversedPolygon: PolygonHandle | null;
  }[];
}

/**
 * The triangulations a display payload left on a body's faces, held after
 * the next feature transaction cleans those faces. A local operation (a
 * chamfer or a fillet) keeps most faces of its input: the same TShape at the
 * same location (IsSame). Putting their display triangulations back before
 * the next display payload meshes the result makes BRepMesh reuse them and
 * mesh only the faces the operation changed. Nothing in OCCT guarantees that
 * this yields the triangles a full remesh at this tier would (an edge shared
 * with a changed face keeps the kept face's polygon; BRepMesh accepts any
 * existing mesh fine enough for the tier): the heavy rows comparing previews
 * and commits with a cold open check it. The captured handles keep those
 * triangulations alive until `releaseDisplayFaceTriangulations`.
 */
export interface DisplayFaceTriangulations {
  readonly lodTierId: OccTessellationTierId;
  readonly faces: FaceMap;
  /** By face map index - 1; null for a face the mesher left untriangulated. */
  readonly captured: readonly (CapturedFaceTriangulation | null)[];
  readonly owned: readonly OccDisposable[];
}

/** Captures `shape`'s face triangulations right after a display meshing at `lodTierId`. */
export function captureDisplayFaceTriangulations(
  oc: Oc,
  shape: Shape,
  lodTierId: OccTessellationTierId,
): DisplayFaceTriangulations {
  // `owned` is what restoring needs, held with the capture; `scratch` only
  // serves the capture and is released before it returns.
  const owned: OccDisposable[] = [];
  const own = <T extends OccDisposable>(object: T) => {
    owned.push(object);
    return object;
  };
  const scratch: OccDisposable[] = [];
  const temp = <T extends OccDisposable>(object: T) => {
    scratch.push(object);
    return object;
  };
  let failure: unknown = null;
  let capture: DisplayFaceTriangulations | null = null;
  try {
    const faces = own(new oc.TopTools_IndexedMapOfShape_1());
    oc.TopExp.MapShapes_1(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      faces,
    );
    const captured: (CapturedFaceTriangulation | null)[] = [];
    for (let index = 1; index <= faces.Size(); index += 1) {
      const face = temp(oc.TopoDS.Face_1(temp(faces.FindKey(index))));
      const location = own(new oc.TopLoc_Location_1());
      const triangulation = oc.BRep_Tool.Triangulation(
        face,
        location,
        0 as never,
      );
      if (triangulation.IsNull()) {
        temp(triangulation);
        captured.push(null);
        continue;
      }
      own(triangulation);
      const faceEdges = temp(new oc.TopTools_IndexedMapOfShape_1());
      oc.TopExp.MapShapes_1(
        face,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
        faceEdges,
      );
      const edges: CapturedFaceTriangulation["edges"] = [];
      for (let edgeIndex = 1; edgeIndex <= faceEdges.Size(); edgeIndex += 1) {
        // A seam's two polygons are read and stored for the forward edge.
        const edge = own(
          oc.TopoDS.Edge_1(
            temp(
              temp(faceEdges.FindKey(edgeIndex)).Oriented(
                oc.TopAbs_Orientation.TopAbs_FORWARD as never,
              ),
            ),
          ),
        );
        const polygon = own(
          oc.BRep_Tool.PolygonOnTriangulation_1(edge, triangulation, location),
        );
        const reversedPolygon = oc.BRep_Tool.IsClosed_2(edge, face)
          ? own(
              oc.BRep_Tool.PolygonOnTriangulation_1(
                temp(oc.TopoDS.Edge_1(temp(edge.Reversed()))),
                triangulation,
                location,
              ),
            )
          : null;
        edges.push({ edge, polygon, reversedPolygon });
      }
      captured.push({ triangulation, location, edges });
    }
    capture = { lodTierId, faces, captured, owned };
  } catch (error) {
    failure = error;
    scratch.push(...owned);
  }
  try {
    releaseOccObjects(scratch);
  } catch (cleanupError) {
    throw failure === null
      ? cleanupError
      : combineOccCleanupError(failure, cleanupError);
  }
  if (failure !== null) throw failure;
  return capture!;
}

/**
 * Puts the captured display triangulation back on every face of `shape` that
 * a capture holds (IsSame), with its edges' polygons, so the next BRepMesh
 * at the capture's tier reuses it. Call it on a cleaned shape, with captures
 * of the tier being meshed. Returns how many faces it restored.
 */
export function restoreDisplayFaceTriangulations(
  oc: Oc,
  shape: Shape,
  captures: readonly DisplayFaceTriangulations[],
) {
  if (captures.length === 0) return 0;
  const owned: OccDisposable[] = [];
  const own = <T extends OccDisposable>(object: T) => {
    owned.push(object);
    return object;
  };
  let restored = 0;
  let failure: unknown = null;
  try {
    const faces = own(new oc.TopTools_IndexedMapOfShape_1());
    oc.TopExp.MapShapes_1(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      faces,
    );
    const builder = own(new oc.BRep_Builder());
    for (let index = 1; index <= faces.Size(); index += 1) {
      const face = own(oc.TopoDS.Face_1(own(faces.FindKey(index))));
      const entry = findCapturedFaceTriangulation(captures, face);
      if (!entry) continue;
      builder.UpdateFace_2(face, entry.triangulation, true);
      for (const { edge, polygon, reversedPolygon } of entry.edges) {
        if (polygon.IsNull()) continue;
        if (reversedPolygon && !reversedPolygon.IsNull()) {
          builder.UpdateEdge_14(
            edge,
            polygon,
            reversedPolygon,
            entry.triangulation,
            entry.location,
          );
        } else {
          builder.UpdateEdge_12(
            edge,
            polygon,
            entry.triangulation,
            entry.location,
          );
        }
      }
      restored += 1;
    }
  } catch (error) {
    failure = error;
  }
  try {
    releaseOccObjects(owned);
  } catch (cleanupError) {
    throw failure === null
      ? cleanupError
      : combineOccCleanupError(failure, cleanupError);
  }
  if (failure !== null) throw failure;
  return restored;
}

function findCapturedFaceTriangulation(
  captures: readonly DisplayFaceTriangulations[],
  face: Shape,
) {
  for (const capture of captures) {
    const index = capture.faces.FindIndex(face);
    if (index > 0) return capture.captured[index - 1] ?? null;
  }
  return null;
}

export function releaseDisplayFaceTriangulations(
  capture: DisplayFaceTriangulations,
) {
  releaseOccObjects(capture.owned);
}

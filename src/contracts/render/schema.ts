import type {
  BodyId,
  FeatureId,
  PickId,
  RenderableId,
} from "@/contracts/shared/ids";
import type {
  DurableRef,
  FaceRef,
  EdgeRef,
  VertexRef,
  ConstructionRef,
  RegionRef,
  SketchEntityRef,
  SketchPointRef,
} from "@/contracts/shared/references";
import type { RenderExportSchemaVersion } from "@/contracts/shared/versioning";

/**
 * Canonical 3D point used by render export payloads.
 * Coordinates are expressed in document modeling units and are owned by the
 * kernel tessellation export, not the viewport.
 */
export type RenderPoint3D = readonly [number, number, number];

/**
 * Semantic classes surfaced by render export bindings.
 * These classes are authoritative selection/highlight hints and must not be
 * inferred by the viewport from geometry representation details.
 */
export type RenderSemanticClass =
  | "bodyFace"
  | "planarFace"
  | "featureEdge"
  | "featureVertex"
  | "region"
  | "sketchCurve"
  | "sketchPoint"
  | "construction";

interface RenderBindingBase {
  /** Transient pick-binding identifier used by viewport hit-testing. */
  pickId: PickId;
  /**
   * Lower values win when multiple exports overlap at one hit location.
   * The export producer owns this ordering policy.
   */
  pickPriority: number;
}

/**
 * Face binding exported by the kernel.
 * The target is a durable face ref and the topology class is authoritative.
 */
export interface RenderFaceBinding extends RenderBindingBase {
  /** Durable face selected when this render record is picked. */
  target: FaceRef;
  /** Authoritative topology class for durable face picks. */
  topology: "face";
  /** Explicit face semantic class consumed by editor selection rules. */
  semanticClass: "bodyFace" | "planarFace";
}

/**
 * Edge binding exported by the kernel.
 */
export interface RenderEdgeBinding extends RenderBindingBase {
  /** Durable edge selected when this render record is picked. */
  target: EdgeRef;
  /** Authoritative topology class for durable edge picks. */
  topology: "edge";
  /** Explicit edge semantic class consumed by editor selection rules. */
  semanticClass: "featureEdge";
}

/**
 * Vertex binding exported by the kernel.
 */
export interface RenderVertexBinding extends RenderBindingBase {
  /** Durable vertex selected when this render record is picked. */
  target: VertexRef;
  /** Authoritative topology class for durable vertex picks. */
  topology: "vertex";
  /** Explicit vertex semantic class consumed by editor selection rules. */
  semanticClass: "featureVertex";
}

/**
 * Construction binding exported by the kernel.
 */
export interface RenderConstructionBinding extends RenderBindingBase {
  /** Durable construction target selected when this render record is picked. */
  target: ConstructionRef;
  /** Construction bindings do not map to body topology primitives. */
  topology: null;
  /** Explicit construction semantic class consumed by editor selection rules. */
  semanticClass: "construction";
}

/**
 * Sketch-curve binding exported by the kernel.
 */
export interface RenderSketchCurveBinding extends RenderBindingBase {
  /** Durable sketch entity selected when this render record is picked. */
  target: SketchEntityRef;
  /** Sketch-curve bindings do not map to body topology primitives. */
  topology: null;
  /** Explicit sketch-curve semantic class consumed by editor selection rules. */
  semanticClass: "sketchCurve";
}

/**
 * Sketch-region binding exported by the kernel.
 */
export interface RenderRegionBinding extends RenderBindingBase {
  /** Durable sketch region selected when this render record is picked. */
  target: RegionRef;
  /** Sketch-region bindings do not map to body topology primitives. */
  topology: null;
  /** Explicit region semantic class consumed by editor selection rules. */
  semanticClass: "region";
}

/**
 * Sketch-point binding exported by the kernel.
 */
export interface RenderSketchPointBinding extends RenderBindingBase {
  /** Durable sketch point selected when this render record is picked. */
  target: SketchPointRef;
  /** Sketch-point bindings do not map to body topology primitives. */
  topology: null;
  /** Explicit sketch-point semantic class consumed by editor selection rules. */
  semanticClass: "sketchPoint";
}

/**
 * Explicit semantic binding for one render export record.
 */
export type RenderSemanticBinding =
  | RenderFaceBinding
  | RenderEdgeBinding
  | RenderVertexBinding
  | RenderConstructionBinding
  | RenderRegionBinding
  | RenderSketchCurveBinding
  | RenderSketchPointBinding;

/**
 * Triangle-mesh export suitable for real kernel tessellation backends.
 * `vertexPositions` must be non-empty.
 * `triangleIndices` must reference only entries in `vertexPositions`, and one
 * render record must use a consistent winding convention across all triangles.
 * `vertexNormals` may be null when the exporter delegates shading normals to
 * the consumer; otherwise it must align 1:1 with `vertexPositions`.
 */
export interface RenderMeshGeometry {
  /** Stable discriminant for triangle-mesh render records. */
  kind: "mesh";
  /** Vertex positions in document modeling units. */
  vertexPositions: readonly RenderPoint3D[];
  /** Per-vertex normals aligned with `vertexPositions`, if the backend provides them. */
  vertexNormals: readonly RenderPoint3D[] | null;
  /** Triangle index triplets into `vertexPositions`. */
  triangleIndices: readonly (readonly [number, number, number])[];
}

/**
 * Polyline export used for edges, sketch curves, and wire previews.
 * Open polylines must contain at least 2 points.
 * Closed polylines must contain at least 3 distinct positions and consumers
 * must connect the final point back to the first even if the first point is
 * not repeated in `points`.
 */
export interface RenderPolylineGeometry {
  /** Stable discriminant for polyline render records. */
  kind: "polyline";
  /** Ordered world-space points in document modeling units. */
  points: readonly RenderPoint3D[];
  /** True when the final point connects back to the first point. */
  isClosed: boolean;
}

/**
 * Point-like marker export for vertices and explicit point references.
 * `displayRadius` is a view hint only and must not be treated as topology.
 */
export interface RenderMarkerGeometry {
  /** Stable discriminant for point-marker render records. */
  kind: "marker";
  /** Marker anchor in document modeling units. */
  position: RenderPoint3D;
  /** View-only radius hint for marker visualization. */
  displayRadius: number;
}

/**
 * Transient render export record for viewport rendering and picking.
 * `id` and `binding.pickId` are transient render keys only.
 * Durable identity is carried exclusively by `binding.target`.
 */
export interface RenderableEntityRecord {
  /** Transient render-record key scoped to one export payload. */
  id: RenderableId;
  /** Human-readable label for inspection/debug surfaces. */
  label: string;
  /** Owning body when this export record belongs to durable body topology. */
  ownerBodyId: BodyId | null;
  /** Owning feature when this export record is derived from one feature. */
  ownerFeatureId: FeatureId | null;
  /** Authoritative semantic binding used for picking and highlighting. */
  binding: RenderSemanticBinding;
  /** Renderer-neutral geometry payload owned by the export producer. */
  geometry: RenderMeshGeometry | RenderPolylineGeometry | RenderMarkerGeometry;
}

/**
 * Versioned render export payload consumed by the viewport.
 */
export interface RenderExport {
  /** Render export schema version for this payload family. */
  schemaVersion: RenderExportSchemaVersion;
  /** Render records owned by this export. */
  records: RenderableEntityRecord[];
}

/**
 * Canonical durable target type that one render record may bind to.
 */
export type RenderTarget = DurableRef;

import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { ToolMetadataBase } from "@/core/tools/metadata";
import type {
  SketchToolControlValue,
  SketchToolPresentationSchema,
} from "@/core/sketch-tools/editor-schema";

export type SketchToolId =
  | "point"
  | "line"
  | "midpointLine"
  | "rectangle"
  | "centerPointRectangle"
  | "alignedRectangle"
  | "circle"
  | "threePointCircle"
  | "centerPointArc"
  | "threePointArc"
  | "tangentArc"
  | "ellipse"
  | "ellipticalArc"
  | "conic"
  | "bezierCurve"
  | "inscribedPolygon"
  | "circumscribedPolygon"
  | "spline"
  | "controlPointSpline"
  | "profileText";

export interface SketchDraftEntityBase {
  id: string;
  entityId: SketchEntityId | null;
  status: "preview" | "accepted";
  label: string;
  isConstruction: boolean;
}

export type SketchDraftEntity =
  | (SketchDraftEntityBase & {
      kind: "line";
      start: SketchPoint;
      end: SketchPoint;
    })
  | (SketchDraftEntityBase & {
      kind: "circle";
      center: SketchPoint;
      radius: number;
    })
  | (SketchDraftEntityBase & {
      kind: "spline";
      points: readonly SketchPoint[];
    })
  | (SketchDraftEntityBase & {
      kind: "polyline";
      points: readonly SketchPoint[];
      isClosed: boolean;
    });

export interface SketchToolMetadata<
  TToolId extends SketchToolId = SketchToolId,
> extends ToolMetadataBase<TToolId> {
  group: "drawing";
  dropdown?: {
    familyId: string;
    variantIds: readonly SketchToolId[];
  };
}

export interface SketchToolRuntimeState {
  status: "idle" | "drawing";
  pointerDownPoint: SketchPoint | null;
  livePoint: SketchPoint | null;
  placedPoints?: readonly SketchPoint[];
  settings?: Record<string, SketchToolControlValue>;
  validationMessage: string | null;
}

export interface SketchToolActivationResult {
  state: SketchToolRuntimeState;
  stagedEntities: readonly SketchDraftEntity[];
  presentation: SketchToolPresentationSchema;
}

export interface SketchToolPointerInput {
  /** Structural source direction at a tangent arc's first placement. */
  tangentSource?: { direction: SketchPoint; center: SketchPoint | null } | null;
  state: SketchToolRuntimeState;
  point: SketchPoint | null;
}

export interface SketchToolPointerResult {
  state: SketchToolRuntimeState;
  stagedEntities: readonly SketchDraftEntity[];
  presentation: SketchToolPresentationSchema;
}

export interface SketchToolValidationResult {
  valid: boolean;
  message: string | null;
}

export interface SketchToolCommitFactories {
  createPointId(suffix: string): SketchPointId;
  createEntityId(suffix: string): SketchEntityId;
  createConstraintId(
    suffix: string,
  ): import("@/contracts/shared/ids").ConstraintId;
  createDimensionId(
    suffix: string,
  ): import("@/contracts/shared/ids").DimensionId;
  createPoint(
    label: string,
    pointId: SketchPointId,
    position: SketchPoint,
  ): SketchPointDefinition;
  createLineEntity(
    label: string,
    entityId: SketchEntityId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
  ): SketchEntityDefinition;
  createPointEntity(
    label: string,
    entityId: SketchEntityId,
    pointId: SketchPointId,
  ): SketchEntityDefinition;
  createCircleEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    radius: number,
  ): SketchEntityDefinition;
  createArcEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
    sweepDirection: "clockwise" | "counterClockwise",
  ): SketchEntityDefinition;
  createSplineEntity(
    label: string,
    entityId: SketchEntityId,
    pointIds: readonly SketchPointId[],
  ): SketchEntityDefinition;
  createEllipseEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    majorAxisPointId: SketchPointId,
    minorRadius: number,
  ): SketchEntityDefinition;
  createEllipticalArcEntity(
    label: string,
    entityId: SketchEntityId,
    centerPointId: SketchPointId,
    majorAxisPointId: SketchPointId,
    startPointId: SketchPointId,
    endPointId: SketchPointId,
    minorRadius: number,
    sweepDirection: "clockwise" | "counterClockwise",
  ): SketchEntityDefinition;
  createConicEntity(
    label: string,
    entityId: SketchEntityId,
    startPointId: SketchPointId,
    controlPointId: SketchPointId,
    endPointId: SketchPointId,
    rho: number,
  ): SketchEntityDefinition;
  createBezierCurveEntity(
    label: string,
    entityId: SketchEntityId,
    controlPointIds: readonly SketchPointId[],
    degree: 2 | 3,
  ): SketchEntityDefinition;
  createProfileTextEntity(
    label: string,
    entityId: SketchEntityId,
    anchorPointId: SketchPointId,
    text: string,
    height: number,
    rotationRadians: number,
    horizontalAlign: "left" | "center" | "right",
    verticalAlign: "baseline" | "middle" | "top" | "bottom",
  ): SketchEntityDefinition;
}

export interface SketchToolCommitInput {
  sequence: number;
  start: SketchPoint;
  end: SketchPoint;
  points?: readonly SketchPoint[];
  settings?: Record<string, SketchToolControlValue>;
  isConstruction: boolean;
  /**
   * The curve a tool with a structural tangent source (Tangent arc) starts
   * tangent to (T13 review R-7): recorded from its first click, not a snap.
   */
  tangentSourceEntityId?: SketchEntityId | null;
  factories: SketchToolCommitFactories;
}

export interface SketchToolCommitContribution {
  points: SketchPointDefinition[];
  entities: SketchEntityDefinition[];
  constraints?: ConstraintDefinition[];
  dimensions?: DimensionDefinition[];
  derivedRelationships?: SketchDerivationDefinition[];
}

/**
 * What one click of a drawing tool becomes (T13-D16), known before the
 * click: an authored `point` of the primitive, the `center` point of the
 * tool's new circle or arc, or a `shape` click that only sizes or orients
 * the primitive (circle and polygon rim, aligned-rectangle height, tangent
 * direction…) and authors no point.
 */
export type SketchPlacementRole = "point" | "center" | "shape";

/**
 * A drawing tool's commit (T13-D16): `placementPointIds[i]` is the point
 * click `i` of the input `points` became, or `null` for a `shape` click.
 * Inferred requirements bind to these ids, never to positions.
 */
export interface SketchToolDrawContribution extends SketchToolCommitContribution {
  placementPointIds: readonly (SketchPointId | null)[];
}

/**
 * How a drawing tool continues after a creation (T11-D9): `chain` continues
 * from the committed end until the chain ends, `discrete` repeats fixed-click
 * primitives, and `fitPoints` adds points until it is finalized with at least
 * `minimum` of them.
 */
export type SketchToolLifecycle =
  | "chain"
  | "discrete"
  | { kind: "fitPoints"; minimum: 2 };

export interface SketchToolDefinition<
  TToolId extends SketchToolId = SketchToolId,
> {
  metadata: SketchToolMetadata<TToolId>;
  lifecycle: SketchToolLifecycle;
  activate(): SketchToolActivationResult;
  pointerMove(input: SketchToolPointerInput): SketchToolPointerResult;
  pointerRelease(input: SketchToolPointerInput): SketchToolPointerResult;
  getStagedEntities(
    state: SketchToolRuntimeState,
  ): readonly SketchDraftEntity[];
  validate(start: SketchPoint, end: SketchPoint): SketchToolValidationResult;
  /** Pure completed-input validation for multi-point contributions, shared with semantic authoring. */
  validateContribution?(points: readonly SketchPoint[], settings: Record<string, SketchToolControlValue>): SketchToolValidationResult;
  getPresentation(state: SketchToolRuntimeState): SketchToolPresentationSchema;
  /** What click `index` of a draft becomes (T13-D16). */
  placementRole(index: number): SketchPlacementRole;
  /**
   * The first click's curve is the tool's tangent source (Tangent arc, T13
   * review R-7): structural, recorded on the tool state, never a snap.
   */
  structuralTangentSource?: true;
  createCommitContribution(
    input: SketchToolCommitInput,
  ): SketchToolDrawContribution;
}

export type ToolbarMode = "part" | "sketch";

export type ToolSource = "toolbar" | "dropdown" | "search" | "shortcut";

export type ToolActivationMode = ToolbarMode | "preserve";

export type ToolCommandBehavior =
  | "undo"
  | "redo"
  | "partImport"
  | "sketchReferenceImageImport";

export type ToolIconId =
  | "undo"
  | "redo"
  | "sketch"
  | "point"
  | "line"
  | "rectangle"
  | "circle"
  | "ellipse"
  | "ellipticalArc"
  | "conic"
  | "bezierCurve"
  | "construction"
  | "spline"
  | "controlPointSpline"
  | "profileText"
  | "dimension"
  | "constraintCoincident"
  | "constraintCollinear"
  | "constraintParallel"
  | "constraintPerpendicular"
  | "constraintTangent"
  | "constraintEqual"
  | "constraintHorizontal"
  | "constraintVertical"
  | "constraintConcentric"
  | "constraintMidpoint"
  | "constraintNormal"
  | "constraintPierce"
  | "constraintSymmetric"
  | "constraintFix"
  | "extrude"
  | "revolve"
  | "sweep"
  | "loft"
  | "split"
  | "fillet"
  | "chamfer"
  | "thicken"
  | "deleteSolid"
  | "shell"
  | "pattern"
  | "linearPattern"
  | "circularPattern"
  | "curvePattern"
  | "moveFace"
  | "mirror"
  | "transform"
  | "measure"
  | "sectionView"
  | "trim"
  | "offset"
  | "sketchFillet"
  | "sketchChamfer"
  | "sketchExtend"
  | "sketchSplit"
  | "sketchSlot"
  | "sketchMergePoints"
  | "finishSketch"
  | "import"
  | "plane"
  | "combine"
  | "svgRendering"
  | "svgFill"
  | "svgStroke"
  | "midpointLine"
  | "centerPointRectangle"
  | "alignedRectangle"
  | "threePointCircle"
  | "centerPointArc"
  | "threePointArc"
  | "tangentArc"
  | "inscribedPolygon"
  | "circumscribedPolygon"
  | "dimensionDistance"
  | "dimensionHorizontal"
  | "dimensionVertical"
  | "dimensionRadius"
  | "projectReference"
  | "importImage"
  | "hole"
  | "sketchMirror"
  | "sketchLinearPattern"
  | "sketchCircularPattern"
  | "sketchTransform";

export interface ToolGroupDefinition<TId extends string = string> {
  id: TId;
  name: string;
  tooltip: string;
  modes: readonly ToolbarMode[];
}

export interface ToolDropdownDefinition<TId extends string = string> {
  familyId: string;
  variantIds: readonly TId[];
}

export interface ToolDefinition<
  TToolId extends string = string,
  TGroupId extends string = string,
  TIcon extends ToolIconId = ToolIconId,
> {
  id: TToolId;
  group: TGroupId;
  name: string;
  tooltip: string;
  icon: TIcon;
  modes: readonly ToolbarMode[];
  activationMode?: ToolActivationMode;
  commandBehavior?: ToolCommandBehavior;
  dropdown?: ToolDropdownDefinition<TToolId>;
}

export interface ToolbarSection<TToolId extends string = string> {
  id: string;
  label: string;
  align: "left" | "center";
  modes: readonly ToolbarMode[];
  toolIds: readonly TToolId[];
  /** Never compacted into a dropdown as the toolbar narrows. */
  pinned?: boolean;
}

export interface ToolTriggerMetadata {
  source: ToolSource;
}

export type ToolbarMode = 'part' | 'sketch'

export type ToolSource = 'toolbar' | 'dropdown' | 'search' | 'shortcut'

export type ToolActivationMode = ToolbarMode | 'preserve'

export type ToolCommandBehavior =
  | 'undo'
  | 'redo'
  | 'partImport'
  | 'sketchReferenceImageImport'

export type ToolIconId =
  | 'undo'
  | 'redo'
  | 'sketch'
  | 'point'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'ellipse'
  | 'ellipticalArc'
  | 'conic'
  | 'bezierCurve'
  | 'construction'
  | 'spline'
  | 'controlPointSpline'
  | 'profileText'
  | 'dimension'
  | 'constraintCoincident'
  | 'constraintCollinear'
  | 'constraintParallel'
  | 'constraintPerpendicular'
  | 'constraintTangent'
  | 'constraintEqual'
  | 'constraintHorizontal'
  | 'constraintVertical'
  | 'constraintConcentric'
  | 'constraintMidpoint'
  | 'constraintNormal'
  | 'constraintPierce'
  | 'constraintSymmetric'
  | 'constraintFix'
  | 'extrude'
  | 'revolve'
  | 'sweep'
  | 'loft'
  | 'split'
  | 'fillet'
  | 'chamfer'
  | 'thicken'
  | 'deleteSolid'
  | 'shell'
  | 'linearPattern'
  | 'circularPattern'
  | 'curvePattern'
  | 'moveFace'
  | 'mirror'
  | 'transform'
  | 'measure'
  | 'sectionView'
  | 'trim'
  | 'offset'
  | 'sketchFillet'
  | 'sketchChamfer'
  | 'sketchExtend'
  | 'sketchSplit'
  | 'sketchSlot'
  | 'finishSketch'
  | 'import'
  | 'search'
  | 'plane'
  | 'combine'
  | 'history'
  | 'svgRendering'
  | 'svgFill'
  | 'svgStroke'
  | 'svgStrokeCap'
  | 'svgStrokeJoin'
  | 'svgGradient'

export interface ToolGroupDefinition<TId extends string = string> {
  id: TId
  name: string
  tooltip: string
  modes: readonly ToolbarMode[]
}

export interface ToolDropdownDefinition<TId extends string = string> {
  familyId: string
  variantIds: readonly TId[]
}

export interface ToolDefinition<
  TToolId extends string = string,
  TGroupId extends string = string,
  TIcon extends ToolIconId = ToolIconId,
> {
  id: TToolId
  group: TGroupId
  name: string
  tooltip: string
  icon: TIcon
  modes: readonly ToolbarMode[]
  activationMode?: ToolActivationMode
  commandBehavior?: ToolCommandBehavior
  dropdown?: ToolDropdownDefinition<TToolId>
}

export interface ToolbarSection<TToolId extends string = string> {
  id: string
  label: string
  align: 'left' | 'center'
  modes: readonly ToolbarMode[]
  toolIds: readonly TToolId[]
}

export interface ToolTriggerMetadata {
  source: ToolSource
}

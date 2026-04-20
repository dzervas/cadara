export type ToolbarMode = 'part' | 'sketch'

export type ToolSource = 'toolbar' | 'dropdown' | 'search' | 'shortcut'

export type ToolIconId =
  | 'undo'
  | 'redo'
  | 'sketch'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'construction'
  | 'spline'
  | 'dimension'
  | 'constraintCoincident'
  | 'constraintParallel'
  | 'constraintPerpendicular'
  | 'constraintTangent'
  | 'constraintEqual'
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
  | 'finishSketch'
  | 'search'
  | 'plane'
  | 'combine'
  | 'history'
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

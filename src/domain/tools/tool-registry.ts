import type {
  ToolDefinition,
  ToolGroupDefinition,
  ToolSource,
  ToolbarSection,
} from '@/domain/tools/schema'
import { getRegisteredFeatureAuthoringDefinitions } from '@/domain/feature-authoring/registry'
import { getRegisteredSketchToolDefinitions } from '@/domain/sketch-tools/registry'
import { getRegisteredSketchEditToolDefinitions } from '@/domain/sketch-edit-tools/registry'
import { getRegisteredSketchConstraintDefinitions } from '@/domain/sketch-constraints/registry'
import { toToolDefinition } from '@/domain/tools/tool-definition-adapter'

export const toolGroups = {
  history: {
    id: 'history',
    name: 'History',
    tooltip: 'Undo and redo editing actions.',
    modes: ['part', 'sketch'],
  },
  sketching: {
    id: 'sketching',
    name: 'Sketch',
    tooltip: 'Create and manage sketches.',
    modes: ['part', 'sketch'],
  },
  drawing: {
    id: 'drawing',
    name: 'Drawing',
    tooltip: 'Create sketch geometry.',
    modes: ['sketch'],
  },
  constraints: {
    id: 'constraints',
    name: 'Constraints',
    tooltip: 'Apply sketch constraints.',
    modes: ['sketch'],
  },
  dimensions: {
    id: 'dimensions',
    name: 'Dimensions',
    tooltip: 'Add and edit dimensions.',
    modes: ['sketch'],
  },
  sketchOps: {
    id: 'sketchOps',
    name: 'Sketch Ops',
    tooltip: 'Edit active sketch geometry.',
    modes: ['sketch'],
  },
  svgStyle: {
    id: 'svgStyle',
    name: 'Style',
    tooltip: 'Configure sketch fill and stroke styling.',
    modes: ['sketch'],
  },
  features: {
    id: 'features',
    name: 'Features',
    tooltip: 'Create solid and surface features.',
    modes: ['part'],
  },
  import: {
    id: 'import',
    name: 'Import',
    tooltip: 'Import external part geometry.',
    modes: ['part'],
  },
  patterns: {
    id: 'patterns',
    name: 'Patterns',
    tooltip: 'Create repeated feature layouts.',
    modes: ['part'],
  },
  transforms: {
    id: 'transforms',
    name: 'Transforms',
    tooltip: 'Transform geometry and references.',
    modes: ['part'],
  },
  inspect: {
    id: 'inspect',
    name: 'Inspect',
    tooltip: 'Inspect geometry and references.',
    modes: ['part'],
  },
} as const satisfies Record<string, ToolGroupDefinition>

export type ToolGroupId = keyof typeof toolGroups

const featureToolDefinitions = getRegisteredFeatureAuthoringDefinitions()
  .map(({ metadata }) => toToolDefinition({
    ...metadata,
    id: metadata.toolId,
    group: metadata.groupId,
  })) satisfies readonly ToolDefinition[]

const sketchToolDefinitions = getRegisteredSketchToolDefinitions()
  .map(({ metadata }) => toToolDefinition(metadata)) satisfies readonly ToolDefinition[]

const sketchEditToolDefinitions = getRegisteredSketchEditToolDefinitions()
  .map(({ metadata }) => toToolDefinition(metadata)) satisfies readonly ToolDefinition[]

const sketchConstraintToolDefinitions = getRegisteredSketchConstraintDefinitions()
  .map(({ metadata }) => toToolDefinition(metadata)) satisfies readonly ToolDefinition[]

const sketchDimensionToolDefinitions = sketchConstraintToolDefinitions.filter((tool) => tool.group === 'dimensions')
const sketchRelationshipToolDefinitions = sketchConstraintToolDefinitions.filter((tool) => tool.group === 'constraints')

export const toolDefinitions = [
  {
    id: 'undo',
    group: 'history',
    name: 'Undo',
    tooltip: 'Undo the last operation.',
    icon: 'undo',
    modes: ['part', 'sketch'],
  },
  {
    id: 'redo',
    group: 'history',
    name: 'Redo',
    tooltip: 'Redo the last undone operation.',
    icon: 'redo',
    modes: ['part', 'sketch'],
  },
  {
    id: 'sketch',
    group: 'sketching',
    name: 'Sketch',
    tooltip: 'Start a new sketch.',
    icon: 'sketch',
    modes: ['part'],
  },
  {
    id: 'finishSketch',
    group: 'sketching',
    name: 'Finish Sketch',
    tooltip: 'Exit the active sketch.',
    icon: 'finishSketch',
    modes: ['sketch'],
  },
  ...sketchToolDefinitions,
  {
    id: 'dimension',
    group: 'dimensions',
    name: 'Distance',
    tooltip: 'Create point-to-point distance dimensions.',
    icon: 'dimension',
    modes: ['sketch'],
    dropdown: {
      familyId: 'dimension-family',
      variantIds: ['dimensionDistance', 'dimensionHorizontal', 'dimensionVertical', 'dimensionRadius'],
    },
  },
  ...sketchDimensionToolDefinitions,
  ...sketchRelationshipToolDefinitions,
  ...sketchEditToolDefinitions,
  {
    id: 'construction',
    group: 'sketchOps',
    name: 'Construction',
    tooltip: 'Toggle sketch geometry construction-only or mark new sketch geometry as construction.',
    icon: 'construction',
    modes: ['sketch'],
  },
  {
    id: 'projectReference',
    group: 'sketchOps',
    name: 'Reference',
    tooltip: 'Reference model or existing sketch geometry in the active sketch.',
    icon: 'construction',
    modes: ['sketch'],
  },
  {
    id: 'svgRendering',
    group: 'svgStyle',
    name: 'SVG Rendering',
    tooltip: 'Toggle authored SVG fill and stroke rendering for the active sketch.',
    icon: 'svgRendering',
    modes: ['sketch'],
  },
  {
    id: 'fill',
    group: 'svgStyle',
    name: 'Fill',
    tooltip: 'Set active sketch fill styling.',
    icon: 'svgFill',
    modes: ['sketch'],
  },
  {
    id: 'stroke',
    group: 'svgStyle',
    name: 'Stroke',
    tooltip: 'Set active sketch stroke styling.',
    icon: 'svgStroke',
    modes: ['sketch'],
  },
  ...featureToolDefinitions,
  {
    id: 'importPart',
    group: 'import',
    name: 'Import Part',
    tooltip: 'Import a STEP, STL, or 3MF mesh file.',
    icon: 'importPart',
    modes: ['part'],
  },
  {
    id: 'linearPattern',
    group: 'patterns',
    name: 'Linear Pattern',
    tooltip: 'Pattern features along a line.',
    icon: 'linearPattern',
    modes: ['part'],
  },
  {
    id: 'circularPattern',
    group: 'patterns',
    name: 'Circular Pattern',
    tooltip: 'Pattern features around an axis.',
    icon: 'circularPattern',
    modes: ['part'],
  },
  {
    id: 'curvePattern',
    group: 'patterns',
    name: 'Curve Pattern',
    tooltip: 'Pattern features along a path.',
    icon: 'curvePattern',
    modes: ['part'],
  },
  {
    id: 'moveFace',
    group: 'transforms',
    name: 'Move Face',
    tooltip: 'Move selected faces.',
    icon: 'moveFace',
    modes: ['part'],
  },
  {
    id: 'measure',
    group: 'inspect',
    name: 'Measure',
    tooltip: 'Inspect geometric measurements.',
    icon: 'measure',
    modes: ['part'],
  },
  {
    id: 'sectionView',
    group: 'inspect',
    name: 'Section View',
    tooltip: 'Create a temporary section view.',
    icon: 'sectionView',
    modes: ['part'],
  },
  {
    id: 'pattern',
    group: 'patterns',
    name: 'Pattern',
    tooltip: 'Choose a pattern tool.',
    icon: 'linearPattern',
    modes: ['part'],
    dropdown: {
      familyId: 'pattern-family',
      variantIds: ['linearPattern', 'circularPattern', 'curvePattern'],
    },
  },
] as const satisfies readonly ToolDefinition[]

export type ToolId = (typeof toolDefinitions)[number]['id']
export type RegisteredToolDefinition = (typeof toolDefinitions)[number]
export type DropdownToolDefinition = Extract<RegisteredToolDefinition, { dropdown: unknown }>
export type ToolDefinitionById<TToolId extends ToolId> = Extract<
  (typeof toolDefinitions)[number],
  { id: TToolId }
>
export type ToolIdsByGroup<TGroupId extends ToolGroupId> = Extract<
  (typeof toolDefinitions)[number],
  { group: TGroupId }
>['id']

export type ToolGroupEventMap = {
  [TGroupId in ToolGroupId]: {
    groupId: TGroupId
    toolId: ToolIdsByGroup<TGroupId>
    mode: ToolDefinitionById<ToolIdsByGroup<TGroupId>>['modes'][number]
    source: ToolSource
    timestamp: number
  }
}

export type ToolEventMap = {
  [TToolId in ToolId]: {
    toolId: TToolId
    groupId: ToolDefinitionById<TToolId>['group']
    mode: ToolDefinitionById<TToolId>['modes'][number]
    source: ToolSource
    timestamp: number
    definition: ToolDefinitionById<TToolId>
  }
}

const toolMap = new Map(toolDefinitions.map((tool) => [tool.id, tool]))

const toolbarSections = [
  {
    id: 'history',
    label: 'History',
    align: 'left',
    modes: ['part', 'sketch'],
    toolIds: ['undo', 'redo'],
  },
  {
    id: 'sketching',
    label: 'Sketch',
    align: 'center',
    modes: ['part', 'sketch'],
    toolIds: ['sketch', 'finishSketch'],
  },
  {
    id: 'drawing',
    label: 'Draw',
    align: 'center',
    modes: ['sketch'],
    toolIds: ['point', 'line', 'rectangle', 'circle', 'centerPointArc', 'ellipse', 'inscribedPolygon', 'spline', 'profileText'],
  },
  {
    id: 'constraints',
    label: 'Constraints',
    align: 'center',
    modes: ['sketch'],
    toolIds: [
      'constraintCoincident',
      'constraintParallel',
      'constraintPerpendicular',
      'constraintTangent',
      'constraintEqual',
      'constraintConcentric',
      'constraintMidpoint',
      'constraintNormal',
      'constraintPierce',
      'constraintSymmetric',
      'constraintFix',
    ],
  },
  {
    id: 'dimensions',
    label: 'Dimension',
    align: 'center',
    modes: ['sketch'],
    toolIds: ['dimension'],
  },
  {
    id: 'sketchOps',
    label: 'Edit',
    align: 'center',
    modes: ['sketch'],
    toolIds: [
      'trim',
      'offset',
      'sketchFillet',
      'sketchChamfer',
      'sketchExtend',
      'sketchSplit',
      'sketchSlot',
      'construction',
      'projectReference',
    ],
  },
  {
    id: 'svgStyle',
    label: 'Style',
    align: 'center',
    modes: ['sketch'],
    toolIds: ['svgRendering', 'fill', 'stroke'],
  },
  {
    id: 'import',
    label: 'Import',
    align: 'center',
    modes: ['part'],
    toolIds: ['importPart'],
  },
  {
    id: 'features',
    label: 'Features',
    align: 'center',
    modes: ['part'],
    toolIds: ['extrude', 'revolve', 'sweep', 'loft', 'split', 'fillet', 'chamfer', 'thicken', 'deleteSolid', 'shell', 'plane', 'combine'],
  },
  {
    id: 'patterns',
    label: 'Patterns',
    align: 'center',
    modes: ['part'],
    toolIds: ['pattern'],
  },
  {
    id: 'transforms',
    label: 'Transforms',
    align: 'center',
    modes: ['part'],
    toolIds: ['moveFace', 'mirror', 'transform'],
  },
  {
    id: 'inspect',
    label: 'Inspect',
    align: 'center',
    modes: ['part'],
    toolIds: ['measure', 'sectionView'],
  },
] as const satisfies readonly ToolbarSection<ToolId>[]

export function getToolById<TToolId extends ToolId>(toolId: TToolId): ToolDefinitionById<TToolId> {
  return toolMap.get(toolId) as ToolDefinitionById<TToolId>
}

export function getToolbarSectionsForMode(mode: 'part' | 'sketch') {
  return toolbarSections.filter((section) =>
    (section.modes as readonly ('part' | 'sketch')[]).includes(mode),
  )
}

export function searchToolDefinitions(query: string) {
  const trimmedQuery = query.trim().toLowerCase()

  if (!trimmedQuery) {
    return []
  }

  return toolDefinitions
    .filter((tool) => tool.id !== 'pattern')
    .filter((tool) => {
      const haystack = `${tool.name} ${tool.tooltip} ${tool.group}`.toLowerCase()
      return haystack.includes(trimmedQuery)
    }) as Exclude<RegisteredToolDefinition, { id: 'pattern' }>[]
}

export function isDropdownTool(tool: RegisteredToolDefinition): tool is DropdownToolDefinition {
  return 'dropdown' in tool
}

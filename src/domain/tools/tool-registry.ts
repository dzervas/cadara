import type {
  ToolDefinition,
  ToolGroupDefinition,
  ToolbarSection,
} from '@/domain/tools/schema'
import { getRegisteredFeatureAuthoringDefinitions } from '@/domain/feature-authoring/registry'
import { getRegisteredSketchToolDefinitions } from '@/domain/sketch-tools/registry'

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
  features: {
    id: 'features',
    name: 'Features',
    tooltip: 'Create solid and surface features.',
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

const featureToolDefinitions = getRegisteredFeatureAuthoringDefinitions().map(({ metadata }) => ({
  id: metadata.toolId,
  group: metadata.groupId,
  name: metadata.name,
  tooltip: metadata.tooltip,
  icon: metadata.icon,
  modes: metadata.modes,
})) satisfies readonly ToolDefinition[]

const sketchToolDefinitions = getRegisteredSketchToolDefinitions().map(({ metadata }) => ({
  id: metadata.id,
  group: metadata.group,
  name: metadata.name,
  tooltip: metadata.tooltip,
  icon: metadata.icon,
  modes: metadata.modes,
})) satisfies readonly ToolDefinition[]

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
    id: 'spline',
    group: 'drawing',
    name: 'Spline',
    tooltip: 'Create spline geometry.',
    icon: 'spline',
    modes: ['sketch'],
  },
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
  {
    id: 'dimensionDistance',
    group: 'dimensions',
    name: 'Distance',
    tooltip: 'Create aligned distance dimensions.',
    icon: 'dimension',
    modes: ['sketch'],
  },
  {
    id: 'dimensionHorizontal',
    group: 'dimensions',
    name: 'Horizontal',
    tooltip: 'Create horizontal distance dimensions.',
    icon: 'dimension',
    modes: ['sketch'],
  },
  {
    id: 'dimensionVertical',
    group: 'dimensions',
    name: 'Vertical',
    tooltip: 'Create vertical distance dimensions.',
    icon: 'dimension',
    modes: ['sketch'],
  },
  {
    id: 'dimensionRadius',
    group: 'dimensions',
    name: 'Radius',
    tooltip: 'Create circle radius dimensions.',
    icon: 'dimension',
    modes: ['sketch'],
  },
  {
    id: 'constraintCoincident',
    group: 'constraints',
    name: 'Coincident',
    tooltip: 'Constrain geometry to shared positions.',
    icon: 'constraintCoincident',
    modes: ['sketch'],
  },
  {
    id: 'constraintParallel',
    group: 'constraints',
    name: 'Parallel',
    tooltip: 'Keep sketch entities parallel.',
    icon: 'constraintParallel',
    modes: ['sketch'],
  },
  {
    id: 'constraintEqual',
    group: 'constraints',
    name: 'Equal',
    tooltip: 'Make sketch entities equal.',
    icon: 'constraintEqual',
    modes: ['sketch'],
  },
  {
    id: 'trim',
    group: 'sketchOps',
    name: 'Trim',
    tooltip: 'Trim sketch segments.',
    icon: 'trim',
    modes: ['sketch'],
  },
  {
    id: 'construction',
    group: 'sketchOps',
    name: 'Construction',
    tooltip: 'Toggle sketch geometry construction-only or mark new sketch geometry as construction.',
    icon: 'construction',
    modes: ['sketch'],
  },
  {
    id: 'offset',
    group: 'sketchOps',
    name: 'Offset',
    tooltip: 'Offset sketch entities.',
    icon: 'offset',
    modes: ['sketch'],
  },
  ...featureToolDefinitions,
  {
    id: 'combine',
    group: 'features',
    name: 'Combine',
    tooltip: 'Boolean selected parts.',
    icon: 'combine',
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
    source: 'toolbar' | 'dropdown' | 'search'
    timestamp: number
  }
}

export type ToolEventMap = {
  [TToolId in ToolId]: {
    toolId: TToolId
    groupId: ToolDefinitionById<TToolId>['group']
    mode: ToolDefinitionById<TToolId>['modes'][number]
    source: 'toolbar' | 'dropdown' | 'search'
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
    toolIds: ['line', 'rectangle', 'circle', 'spline'],
  },
  {
    id: 'constraints',
    label: 'Constraints',
    align: 'center',
    modes: ['sketch'],
    toolIds: ['constraintCoincident', 'constraintParallel', 'constraintEqual'],
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
    toolIds: ['trim', 'construction', 'offset'],
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

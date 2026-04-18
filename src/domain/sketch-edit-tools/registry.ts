import type { SketchEditToolDefinition, SketchEditToolId } from '@/domain/sketch-edit-tools/definition'

export const sketchEditToolDefinitions = [
  {
    metadata: {
      id: 'trim',
      group: 'sketchOps',
      name: 'Trim',
      tooltip: 'Trim sketch segments.',
      icon: 'trim',
      modes: ['sketch'],
    },
  },
  {
    metadata: {
      id: 'offset',
      group: 'sketchOps',
      name: 'Offset',
      tooltip: 'Offset sketch entities.',
      icon: 'offset',
      modes: ['sketch'],
    },
  },
] as const satisfies readonly SketchEditToolDefinition[]

const sketchEditToolMap = new Map<SketchEditToolId, SketchEditToolDefinition>(
  sketchEditToolDefinitions.map((definition) => [definition.metadata.id, definition]),
)

export function getRegisteredSketchEditToolDefinitions(): readonly SketchEditToolDefinition[] {
  return sketchEditToolDefinitions
}

export function isRegisteredSketchEditToolId(toolId: string): toolId is SketchEditToolId {
  return sketchEditToolMap.has(toolId as SketchEditToolId)
}

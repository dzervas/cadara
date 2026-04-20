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
      selection: {
        label: 'Trim target',
        acceptedKinds: ['line', 'circle', 'arc', 'spline'],
        requiredCount: 1,
      },
      previewLabel: 'Trim preview',
      validationMessages: {
        emptySelection: 'Select a segment to trim.',
        unsupportedTarget: 'Trim supports line, circle, arc, and spline entities.',
      },
      mutationContract: 'trimAtIntersections',
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
      selection: {
        label: 'Offset target',
        acceptedKinds: ['line', 'circle', 'arc', 'spline'],
        requiredCount: 1,
        allowsMultiple: true,
      },
      previewLabel: 'Offset preview',
      validationMessages: {
        emptySelection: 'Select entities to offset.',
        unsupportedTarget: 'Offset supports line, circle, arc, and spline entities.',
      },
      mutationContract: 'createOffsetGeometry',
    },
  },
  {
    metadata: {
      id: 'sketchFillet',
      group: 'sketchOps',
      name: 'Sketch Fillet',
      tooltip: 'Round a supported sketch corner.',
      icon: 'sketchFillet',
      modes: ['sketch'],
      selection: {
        label: 'Fillet corner',
        acceptedKinds: ['line'],
        requiredCount: 2,
      },
      previewLabel: 'Fillet preview',
      validationMessages: {
        emptySelection: 'Select two adjacent sketch lines to fillet.',
        unsupportedTarget: 'Sketch fillet currently supports two adjacent line segments.',
      },
      mutationContract: 'replaceCornerWithFilletArc',
    },
  },
  {
    metadata: {
      id: 'sketchChamfer',
      group: 'sketchOps',
      name: 'Sketch Chamfer',
      tooltip: 'Bevel a supported sketch corner.',
      icon: 'sketchChamfer',
      modes: ['sketch'],
      selection: {
        label: 'Chamfer corner',
        acceptedKinds: ['line'],
        requiredCount: 2,
      },
      previewLabel: 'Chamfer preview',
      validationMessages: {
        emptySelection: 'Select two adjacent sketch lines to chamfer.',
        unsupportedTarget: 'Sketch chamfer currently supports two adjacent line segments.',
      },
      mutationContract: 'replaceCornerWithChamferLine',
    },
  },
  {
    metadata: {
      id: 'sketchExtend',
      group: 'sketchOps',
      name: 'Sketch Extend',
      tooltip: 'Extend a sketch curve to a supported boundary.',
      icon: 'sketchExtend',
      modes: ['sketch'],
      selection: {
        label: 'Extend target and boundary',
        acceptedKinds: ['line'],
        requiredCount: 2,
      },
      previewLabel: 'Extend preview',
      validationMessages: {
        emptySelection: 'Select a sketch line, then a boundary line.',
        unsupportedTarget: 'Sketch extend currently supports a line extended to another line.',
      },
      mutationContract: 'extendCurveToBoundary',
    },
  },
  {
    metadata: {
      id: 'sketchSplit',
      group: 'sketchOps',
      name: 'Sketch Split',
      tooltip: 'Split a sketch curve at a supported boundary.',
      icon: 'sketchSplit',
      modes: ['sketch'],
      selection: {
        label: 'Split target and boundary',
        acceptedKinds: ['line'],
        requiredCount: 2,
      },
      previewLabel: 'Split preview',
      validationMessages: {
        emptySelection: 'Select a sketch line, then a crossing boundary line.',
        unsupportedTarget: 'Sketch split currently supports a line split by another line.',
      },
      mutationContract: 'splitCurveAtBoundary',
    },
  },
  {
    metadata: {
      id: 'sketchSlot',
      group: 'sketchOps',
      name: 'Slot',
      tooltip: 'Create slot boundary geometry around selected sketch references.',
      icon: 'sketchSlot',
      modes: ['sketch'],
      selection: {
        label: 'Slot reference',
        acceptedKinds: ['line', 'arc', 'spline'],
        requiredCount: 1,
        allowsMultiple: true,
      },
      previewLabel: 'Slot preview',
      validationMessages: {
        emptySelection: 'Select a line, arc, spline, or closed line profile for the slot.',
        unsupportedTarget: 'Slot supports a line, arc, spline, or closed line profile.',
      },
      mutationContract: 'createSlotBoundary',
    },
  },
] as const satisfies readonly SketchEditToolDefinition[]

const sketchEditToolMap = new Map<SketchEditToolId, SketchEditToolDefinition>(
  sketchEditToolDefinitions.map((definition) => [definition.metadata.id, definition]),
)

export function getRegisteredSketchEditToolDefinitions(): readonly SketchEditToolDefinition[] {
  return sketchEditToolDefinitions
}

export function getSketchEditToolDefinition(toolId: SketchEditToolId): SketchEditToolDefinition {
  const definition = sketchEditToolMap.get(toolId)

  if (!definition) {
    throw new Error(`Unknown sketch edit tool: ${toolId}`)
  }

  return definition
}

export function isRegisteredSketchEditToolId(toolId: string): toolId is SketchEditToolId {
  return sketchEditToolMap.has(toolId as SketchEditToolId)
}

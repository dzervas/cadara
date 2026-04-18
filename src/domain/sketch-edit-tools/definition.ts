import type { ToolIconId, ToolbarMode } from '@/domain/tools/schema'

export type SketchEditToolId = 'trim' | 'offset'

export interface SketchEditToolMetadata<TToolId extends SketchEditToolId = SketchEditToolId> {
  id: TToolId
  name: string
  tooltip: string
  icon: ToolIconId
  group: 'sketchOps'
  modes: readonly ToolbarMode[]
}

export interface SketchEditToolDefinition<TToolId extends SketchEditToolId = SketchEditToolId> {
  metadata: SketchEditToolMetadata<TToolId>
}

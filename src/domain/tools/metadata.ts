import type { ToolIconId, ToolbarMode } from '@/domain/tools/schema'

export interface ToolMetadataBase<TId extends string = string> {
  id: TId
  name: string
  tooltip: string
  icon: ToolIconId
  modes: readonly ToolbarMode[]
}


import type { ToolDefinition, ToolDropdownDefinition } from '@/domain/tools/schema'

export interface ToolDefinitionMetadata<
  TToolId extends string = string,
  TGroupId extends string = string,
> {
  id: TToolId
  group: TGroupId
  name: string
  tooltip: string
  icon: ToolDefinition<TToolId, TGroupId>['icon']
  modes: ToolDefinition<TToolId, TGroupId>['modes']
  dropdown?: ToolDropdownDefinition<TToolId>
}

export function toToolDefinition<
  TToolId extends string,
  TGroupId extends string,
>(metadata: ToolDefinitionMetadata<TToolId, TGroupId>): ToolDefinition<TToolId, TGroupId> {
  return {
    id: metadata.id,
    group: metadata.group,
    name: metadata.name,
    tooltip: metadata.tooltip,
    icon: metadata.icon,
    modes: metadata.modes,
    ...(metadata.dropdown ? { dropdown: metadata.dropdown } : {}),
  }
}


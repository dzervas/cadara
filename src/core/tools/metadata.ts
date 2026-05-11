import type { ToolIconId, ToolbarMode } from "@/core/tools/schema";

export interface ToolMetadataBase<TId extends string = string> {
  id: TId;
  name: string;
  tooltip: string;
  icon: ToolIconId;
  modes: readonly ToolbarMode[];
}

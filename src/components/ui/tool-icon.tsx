import type { ToolIconId } from "@/core/tools/schema";
import { getToolIconAssetFileName } from "@/core/tools/tool-icons";
import { SvgIcon } from "@/components/ui/svg-icon";
import { cn } from "@/lib/utils";

interface ToolIconProps {
  icon: ToolIconId;
  className?: string;
  draggable?: boolean;
}

export function ToolIcon({
  icon,
  className,
  draggable = false,
}: ToolIconProps) {
  return (
    <SvgIcon
      fileName={getToolIconAssetFileName(icon)}
      highlight
      className={cn("h-5 w-5", className)}
      draggable={draggable}
    />
  );
}

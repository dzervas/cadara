import type { ToolIconId } from "@/core/tools/schema";
import { getToolIconSrc } from "@/core/tools/tool-icons";
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
    <img
      src={getToolIconSrc(icon)}
      alt=""
      aria-hidden="true"
      className={cn("h-5 w-5", className)}
      loading="lazy"
      decoding="async"
      draggable={draggable}
    />
  );
}

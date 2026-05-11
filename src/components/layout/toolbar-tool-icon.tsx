import type { ToolIconId } from "@/core/tools/schema";
import { ToolIcon } from "@/components/ui/tool-icon";

interface ToolbarToolIconProps {
  icon: ToolIconId;
  className?: string;
}

export function ToolbarToolIcon({ icon, className }: ToolbarToolIconProps) {
  return <ToolIcon icon={icon} className={className} />;
}

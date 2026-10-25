import type { CSSProperties } from "react";
import { SvgIcon } from "@/components/ui/svg-icon";

import {
  workbenchIconAssetMap,
  type WorkbenchIconName,
} from "@/components/ui/workbench-icon-assets";
export type { WorkbenchIconName } from "@/components/ui/workbench-icon-assets";

interface WorkbenchIconProps {
  name: WorkbenchIconName;
  className?: string;
  size?: number;
  style?: CSSProperties;
}

export function WorkbenchIcon({
  name,
  className,
  size,
  style,
}: WorkbenchIconProps) {
  return (
    <SvgIcon
      fileName={workbenchIconAssetMap[name]}
      className={className}
      size={size}
      style={style}
    />
  );
}

import type { ToolIconId } from '@/domain/tools/schema'
import { toolbarToolIconAssetMap } from '@/components/layout/toolbar-tool-icon-assets'
import { cn } from '@/lib/utils'

interface ToolbarToolIconProps {
  icon: ToolIconId
  className?: string
}

export function ToolbarToolIcon({ icon, className }: ToolbarToolIconProps) {
  return (
    <img
      src={`/icons/${toolbarToolIconAssetMap[icon]}`}
      alt=""
      aria-hidden="true"
      className={cn('h-4 w-4 shrink-0', className)}
      loading="lazy"
      decoding="async"
    />
  )
}

import type { ToolIconId } from '@/domain/tools/schema'
import { getToolbarToolIconSrc } from '@/components/layout/toolbar-tool-icon-src'
import { cn } from '@/lib/utils'

interface ToolbarToolIconProps {
  icon: ToolIconId
  className?: string
}

export function ToolbarToolIcon({ icon, className }: ToolbarToolIconProps) {
  return (
    <img
      src={getToolbarToolIconSrc(icon)}
      alt=""
      aria-hidden="true"
      className={cn('h-8 w-8 shrink-0', className)}
      loading="lazy"
      decoding="async"
    />
  )
}

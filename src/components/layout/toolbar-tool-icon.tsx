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
      className={cn('h-5 w-5', className)}
      loading="lazy"
      decoding="async"
    />
  )
}

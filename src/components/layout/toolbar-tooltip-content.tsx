import { ShortcutHint } from '@/components/shortcuts/shortcut-hint'
import type { ShortcutCommandId } from '@/core/shortcuts/commands'

interface ToolbarTooltipContentProps {
  title: string
  description: string
  commandId?: ShortcutCommandId
}

export function ToolbarTooltipContent({
  commandId,
  title,
  description,
}: ToolbarTooltipContentProps) {
  return (
    <div className="flex max-w-64 flex-col gap-1 whitespace-normal break-words">
      <span className="flex min-w-0 items-start justify-between gap-3 text-xs font-semibold text-[var(--workbench-tooltip-title)]">
        <span className="min-w-0">{title}</span>
        {commandId ? <ShortcutHint commandId={commandId} /> : null}
      </span>
      <span className="text-xs leading-relaxed text-[var(--workbench-tooltip-description)]">
        {description}
      </span>
    </div>
  )
}

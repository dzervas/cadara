import { ShortcutHint } from '@/components/shortcuts/shortcut-hint'
import type { ShortcutCommandId } from '@/domain/shortcuts/commands'

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
    <div className="flex max-w-56 flex-col gap-1">
      <span className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--workbench-tooltip-title)]">
        <span>{title}</span>
        {commandId ? <ShortcutHint commandId={commandId} /> : null}
      </span>
      <span className="text-xs leading-relaxed text-[var(--workbench-tooltip-description)]">
        {description}
      </span>
    </div>
  )
}

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ToolbarToolIcon } from '@/components/layout/toolbar-tool-icon'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import type { RegisteredToolDefinition } from '@/domain/tools/tool-registry'
import { useToolActions } from '@/hooks/use-tool-actions'

interface ToolButtonProps {
  tool: RegisteredToolDefinition
  inline?: boolean
  onTrigger?: () => void
  active?: boolean
}

export function ToolButton({
  tool,
  inline = false,
  onTrigger,
  active = false,
}: ToolButtonProps) {
  const { triggerTool } = useToolActions()

  const handleClick = () => {
    triggerTool(tool.id, {
      source: inline ? 'search' : 'toolbar',
    })
    onTrigger?.()
  }

  const content = inline ? (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-[var(--cad-surface-elevated)] ${
        active ? 'bg-[var(--cad-surface-elevated)]' : ''
      }`}
      aria-label={tool.name}
      data-tool-id={tool.id}
      data-tool-source="search"
      data-tool-tooltip={tool.tooltip}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--cad-border)] bg-[var(--cad-surface)] text-[var(--cad-foreground)]">
        <ToolbarToolIcon icon={tool.icon} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-[var(--cad-foreground)]">
          {tool.name}
        </span>
        <span className="block truncate text-xs text-[var(--cad-muted-foreground)]">
          {tool.tooltip}
        </span>
      </span>
    </button>
  ) : (
    <button
      type="button"
      onClick={handleClick}
      className={`flex h-10 w-10 items-center justify-center rounded-lg border bg-transparent text-[var(--cad-foreground)] transition hover:border-[var(--cad-border-strong)] hover:bg-[var(--cad-surface-elevated)] ${
        active
          ? 'border-[var(--cad-border-strong)] bg-[var(--cad-surface-elevated)]'
          : 'border-transparent'
      }`}
      aria-label={tool.name}
      aria-pressed={active}
      data-tool-id={tool.id}
      data-tool-source="toolbar"
      data-tool-tooltip={tool.tooltip}
    >
      <ToolbarToolIcon icon={tool.icon} />
    </button>
  )

  if (inline) {
    return content
  }

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>
          <ToolbarTooltipContent title={tool.name} description={tool.tooltip} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

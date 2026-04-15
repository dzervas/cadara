interface ToolbarTooltipContentProps {
  title: string
  description: string
}

export function ToolbarTooltipContent({
  title,
  description,
}: ToolbarTooltipContentProps) {
  return (
    <div className="flex max-w-56 flex-col gap-1">
      <span className="text-xs font-semibold text-[var(--workbench-tooltip-title)]">{title}</span>
      <span className="text-xs leading-relaxed text-[var(--workbench-tooltip-description)]">
        {description}
      </span>
    </div>
  )
}

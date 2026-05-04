import type { CSSProperties } from 'react'

export const toolbarActionIconClassName = 'workbench-toolbar-action'
export const sparkLogoClassName = 'workbench-spark-logo'

interface ToolbarActionIconStyleOptions {
  active?: boolean
  success?: boolean
}

type ToolbarActionIconStyle = CSSProperties & Partial<Record<`--workbench-toolbar-action-${string}`, string>>

export function getToolbarActionIconStyle({
  active = false,
  success = false,
}: ToolbarActionIconStyleOptions = {}): ToolbarActionIconStyle {
  const hoverBackground = success
    ? 'var(--workbench-shell-success-surface)'
    : active
      ? 'var(--workbench-shell-accent-surface-hover)'
      : 'var(--workbench-toolbar-button-hover-background)'
  const hoverBorder = success
    ? 'var(--workbench-shell-success-border)'
    : active
      ? 'var(--workbench-shell-accent)'
      : 'var(--workbench-toolbar-button-hover-border)'

  return {
    '--workbench-toolbar-action-hover-bg': hoverBackground,
    '--workbench-toolbar-action-hover-border': hoverBorder,
    '--workbench-toolbar-action-press-bg': success
      ? 'var(--workbench-shell-success-surface)'
      : 'var(--workbench-toolbar-button-press-background)',
  }
}

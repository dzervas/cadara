import type React from 'react'

export const SECTION_HEADER_CLASSES =
  'text-[10px] font-semibold uppercase tracking-[0.20em] text-[var(--mantine-color-dark-3)]'

export function fieldSurfaceStyle(
  field: { error?: { message: string } | null },
  isActive = false,
): React.CSSProperties {
  if (field.error) {
    return {
      background: 'var(--workbench-shell-danger-surface)',
      boxShadow: '0 0 0 1px var(--workbench-shell-danger-border)',
      color: 'var(--workbench-shell-danger-text)',
    }
  }

  if (isActive) {
    return {
      background: 'var(--workbench-shell-overlay-strong)',
      boxShadow: '0 0 0 1px var(--workbench-shell-accent)',
      color: 'var(--mantine-color-workbench-4)',
    }
  }

  return {
    background: 'var(--workbench-shell-overlay-soft)',
    color: 'var(--mantine-color-dark-0)',
  }
}

export function compactInputStyles(input: { hasError?: boolean; disabled?: boolean } = {}) {
  return {
    input: {
      backgroundColor: 'transparent',
      border: 0,
      color: input.disabled ? 'var(--workbench-shell-text-dim)' : 'var(--workbench-shell-text)',
      fontFamily: 'var(--mantine-font-family-monospace)',
      fontSize: 12.5,
      height: 28,
      minHeight: 28,
      paddingInline: 4,
    },
  }
}

export function compactActionIconStyles(input: { active?: boolean; danger?: boolean } = {}) {
  return {
    root: {
      backgroundColor: 'transparent',
      border: 0,
      color: input.danger
        ? 'var(--workbench-shell-danger-text)'
        : input.active
          ? 'var(--workbench-shell-accent)'
          : 'var(--workbench-shell-text-muted)',
      flex: '0 0 auto',
      opacity: input.active ? 1 : 0.72,
    },
  }
}

export function compactSelectStyles(input: { disabled?: boolean } = {}) {
  return {
    input: {
      backgroundColor: 'transparent',
      border: 0,
      color: input.disabled ? 'var(--workbench-shell-text-dim)' : 'var(--workbench-shell-text)',
      fontSize: 12.5,
      height: 28,
      minHeight: 28,
      paddingLeft: 4,
    },
    section: {
      color: 'var(--workbench-shell-text-muted)',
    },
    dropdown: {
      backgroundColor: 'var(--workbench-shell-overlay-strong)',
      border: 'none',
      boxShadow: 'var(--workbench-shell-elevation-md)',
    },
    option: {
      color: 'var(--workbench-shell-text)',
    },
  }
}

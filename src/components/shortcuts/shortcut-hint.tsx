import { Text } from '@mantine/core'

import type { ShortcutCommandId } from '@/core/shortcuts/commands'
import { formatShortcut, type ShortcutSequence } from '@/core/shortcuts/shortcut-grammar'
import { useShortcutDisplay } from '@/hooks/use-shortcuts'

interface ShortcutHintProps {
  commandId?: ShortcutCommandId
  shortcut?: ShortcutSequence | null
}

export function ShortcutHint({ commandId, shortcut }: ShortcutHintProps) {
  const resolvedShortcut = useShortcutDisplay(commandId ?? 'editor.cancel')
  const displayShortcut = shortcut === undefined ? resolvedShortcut : shortcut

  if (!displayShortcut) {
    return null
  }

  return (
    <Text
      component="span"
      size="11px"
      data-shortcut-hint={commandId}
      style={{
        color: 'var(--workbench-shell-text-muted)',
        fontFamily: 'var(--mantine-font-family-monospace)',
        whiteSpace: 'nowrap',
      }}
    >
      {formatShortcut(displayShortcut)}
    </Text>
  )
}

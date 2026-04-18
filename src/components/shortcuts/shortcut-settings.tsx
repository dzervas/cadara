import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Button, Group, Modal, ScrollArea, Table, Text } from '@mantine/core'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { getRecordedShortcutStep } from '@/components/shortcuts/shortcut-recording'
import {
  appendShortcutRecordingStep,
  cancelShortcutRecording,
  completeShortcutRecording,
  createInitialShortcutSettingsState,
  getPendingRecordedShortcut,
  getShortcutSettingsDisplayLabel,
  setShortcutConflictState,
  startShortcutRecording,
} from '@/components/shortcuts/shortcut-settings-model'
import type { ShortcutCommandId } from '@/domain/shortcuts/commands'
import { createShortcutReferenceGroups } from '@/domain/shortcuts/reference'
import { useShortcuts } from '@/hooks/use-shortcuts'

export function ShortcutSettingsButton() {
  const [opened, setOpened] = useState(false)

  return (
    <>
      <ActionIcon
        type="button"
        variant="subtle"
        color="workbench"
        aria-label="Keyboard shortcuts"
        onClick={() => setOpened(true)}
      >
        <WorkbenchIcon name="keyboard" className="h-4 w-4" />
      </ActionIcon>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Keyboard shortcuts"
        size="xl"
        centered
      >
        <ShortcutSettings />
      </Modal>
    </>
  )
}

export function ShortcutSettings() {
  const shortcuts = useShortcuts()
  const [settingsState, setSettingsState] = useState(createInitialShortcutSettingsState)
  const { conflictMessage, recordingCommandId, recordingSteps } = settingsState
  const groups = useMemo(
    () => createShortcutReferenceGroups(shortcuts.registry, shortcuts.effectiveKeymap),
    [shortcuts.effectiveKeymap, shortcuts.registry],
  )

  useEffect(() => {
    if (!recordingCommandId || typeof window === 'undefined') {
      return
    }

    const handleRecordingKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const step = getRecordedShortcutStep(event)
      if (!step) {
        return
      }

      setSettingsState((current) => appendShortcutRecordingStep(current, step))
    }

    window.addEventListener('keydown', handleRecordingKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleRecordingKeyDown, { capture: true })
  }, [recordingCommandId])

  const finishRecording = (commandId: ShortcutCommandId) => {
    const shortcut = getPendingRecordedShortcut(settingsState)
    if (!shortcut) {
      return
    }

    const conflicts = shortcuts.setCommandShortcuts(commandId, [shortcut])
    setSettingsState((current) => completeShortcutRecording(current, conflicts))
  }

  return (
    <div
      className="flex min-h-0 flex-col gap-3"
      data-shortcut-settings
    >
      <Group justify="space-between" gap="sm">
        <Text size="sm" c="dimmed">
          {shortcuts.commands.length} commands
        </Text>
        <Button size="xs" variant="subtle" onClick={shortcuts.resetAllShortcuts}>
          Reset all
        </Button>
      </Group>
      {conflictMessage ? (
        <Text size="sm" c="red" role="alert">
          {conflictMessage}
        </Text>
      ) : null}
      <ScrollArea.Autosize mah={520}>
        {groups.map((group) => (
          <section key={group.category} className="mb-5" data-shortcut-reference-group={group.category}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
              {group.category}
            </Text>
            <Table verticalSpacing={6} horizontalSpacing="sm">
              <Table.Tbody>
                {group.commands.map(({ command, shortcutLabel }) => {
                  const isRecording = recordingCommandId === command.id

                  return (
                    <Table.Tr key={command.id} data-shortcut-command={command.id}>
                      <Table.Td>
                        <Text size="sm">{command.label}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          component="span"
                          size="sm"
                          ff="monospace"
                          c={shortcutLabel ? undefined : 'dimmed'}
                          data-shortcut-current={command.id}
                        >
                          {getShortcutSettingsDisplayLabel({
                            isRecording,
                            recordingSteps,
                            shortcutLabel,
                          })}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group justify="flex-end" gap={4}>
                          {isRecording ? (
                            <>
                              <Button
                                size="compact-xs"
                                variant="filled"
                                onClick={() => finishRecording(command.id)}
                              >
                                Save
                              </Button>
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                onClick={() => setSettingsState(cancelShortcutRecording())}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              onClick={() => setSettingsState((current) => startShortcutRecording(current, command.id))}
                            >
                              Record
                            </Button>
                          )}
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() => shortcuts.disableCommandShortcuts(command.id)}
                          >
                            Disable
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() => {
                              const conflicts = shortcuts.resetCommandShortcuts(command.id)
                              setSettingsState((current) => setShortcutConflictState(current, conflicts))
                            }}
                          >
                            Reset
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </section>
        ))}
      </ScrollArea.Autosize>
    </div>
  )
}

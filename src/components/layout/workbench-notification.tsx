import { ActionIcon, Box, Button, Group, Paper, Stack, Text } from '@mantine/core'
import { useEffect, type CSSProperties } from 'react'

import { WorkbenchIcon, type WorkbenchIconName } from '@/components/ui/workbench-icon'
import {
  scheduleWorkbenchNotificationAutoDismiss,
  type WorkbenchNotificationModel,
  type WorkbenchNotificationPlacement,
  type WorkbenchNotificationType,
} from '@/components/layout/workbench-notification-model'

interface WorkbenchNotificationProps extends WorkbenchNotificationModel {
  className?: string
  dismissLabel?: string
  style?: CSSProperties
}

const notificationIcons: Record<WorkbenchNotificationType, WorkbenchIconName> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
}

export function WorkbenchNotification({
  action,
  className,
  dismissLabel = 'Dismiss notification',
  message,
  onDismiss,
  placement,
  style,
  title,
  type,
}: WorkbenchNotificationProps) {
  useEffect(() => {
    if (!onDismiss) {
      return undefined
    }

    return scheduleWorkbenchNotificationAutoDismiss(type, onDismiss) ?? undefined
  }, [onDismiss, type])

  const role = type === 'error' ? 'alert' : 'status'
  const liveMode = type === 'error' ? 'assertive' : 'polite'

  return (
    <Paper
      role={role}
      aria-live={liveMode}
      data-notification-type={type}
      className={[
        getPlacementClassName(placement),
        'z-30 flex min-w-0 max-w-sm items-stretch overflow-hidden border text-xs shadow-[var(--cad-panel-shadow)]',
        className,
      ].filter(Boolean).join(' ')}
      style={{
        ...getNotificationStyle(type),
        ...getPlacementStyle(placement),
        ...style,
      }}
    >
      <Box
        aria-hidden="true"
        data-notification-accent={type}
        className="w-1 shrink-0"
        style={{ backgroundColor: 'var(--workbench-notification-active-accent)' }}
      />
      <Group align="flex-start" gap="sm" className="min-w-0 flex-1 px-3 py-2">
        <Box
          aria-hidden="true"
          data-notification-icon={type}
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center"
          style={{ color: 'var(--workbench-notification-active-accent)' }}
        >
          <WorkbenchIcon name={notificationIcons[type]} size={16} />
        </Box>
        <Stack gap={4} className="min-w-0 flex-1 leading-5">
          <Text
            component="div"
            fw={600}
            size="xs"
            className="min-w-0"
            style={{ color: 'var(--workbench-notification-active-title)' }}
          >
            {title}
          </Text>
          <Text
            component="div"
            size="xs"
            className="min-w-0"
            style={{ color: 'var(--workbench-notification-text-muted)' }}
          >
            {message}
          </Text>
          {action ? (
            <Button
              variant="default"
              size="xs"
              className="mt-1 self-start border-[var(--cad-border-strong)] bg-[var(--cad-surface)] text-[var(--cad-foreground)]"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ) : null}
        </Stack>
        {onDismiss ? (
          <ActionIcon
            aria-label={dismissLabel}
            size={24}
            variant="subtle"
            className="shrink-0 border border-[var(--cad-border-strong)] text-[var(--cad-muted-foreground)] hover:bg-[var(--cad-surface)] hover:text-[var(--cad-foreground)]"
            onClick={onDismiss}
          >
            <WorkbenchIcon name="close" size={12} />
          </ActionIcon>
        ) : null}
      </Group>
    </Paper>
  )
}

function getPlacementClassName(placement: WorkbenchNotificationPlacement | undefined) {
  if (placement?.kind === 'app-top-center') {
    return 'fixed left-1/2 top-3 w-[min(720px,calc(100vw-24px))] -translate-x-1/2'
  }

  if (placement?.kind === 'viewport') {
    return 'absolute'
  }

  return ''
}

function getPlacementStyle(placement: WorkbenchNotificationPlacement | undefined): CSSProperties {
  if (placement?.kind !== 'viewport') {
    return {}
  }

  return {
    right: placement.right,
    top: placement.top,
  }
}

function getNotificationStyle(type: WorkbenchNotificationType) {
  return {
    '--workbench-notification-active-accent': `var(--workbench-notification-${type}-accent)`,
    '--workbench-notification-active-border': `var(--workbench-notification-${type}-border)`,
    '--workbench-notification-active-title': `var(--workbench-notification-${type}-title)`,
    backgroundColor: 'var(--workbench-notification-surface)',
    borderColor: 'var(--workbench-notification-active-border)',
    color: 'var(--workbench-notification-text)',
  } as CSSProperties
}

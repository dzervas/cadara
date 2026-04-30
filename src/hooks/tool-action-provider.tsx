import { useMemo } from 'react'
import type { PropsWithChildren } from 'react'

import { ToolActionContext } from '@/hooks/tool-action-context'
import type { ToolActionBus } from '@/core/tools/tool-action-bus'

interface ToolActionProviderProps extends PropsWithChildren {
  actionBus: ToolActionBus
}

export function ToolActionProvider({ actionBus, children }: ToolActionProviderProps) {
  const value = useMemo(
    () => ({
      actionBus,
    }),
    [actionBus],
  )

  return <ToolActionContext.Provider value={value}>{children}</ToolActionContext.Provider>
}

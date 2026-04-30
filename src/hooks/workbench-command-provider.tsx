import { useMemo, type PropsWithChildren } from 'react'

import type { WorkbenchCommandHandlers } from '@/hooks/workbench-command-context'
import { WorkbenchCommandContext } from '@/hooks/workbench-command-context'

interface WorkbenchCommandProviderProps extends PropsWithChildren {
  handlers: WorkbenchCommandHandlers
}

export function WorkbenchCommandProvider({
  children,
  handlers,
}: WorkbenchCommandProviderProps) {
  const value = useMemo(() => handlers, [handlers])

  return (
    <WorkbenchCommandContext.Provider value={value}>
      {children}
    </WorkbenchCommandContext.Provider>
  )
}

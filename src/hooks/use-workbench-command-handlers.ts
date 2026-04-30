import { WorkbenchCommandContext } from '@/hooks/workbench-command-context'
import { createRequiredContextHook } from '@/hooks/create-required-context-hook'

export const useWorkbenchCommandHandlers = createRequiredContextHook(
  WorkbenchCommandContext,
  'useWorkbenchCommandHandlers',
  'WorkbenchCommandProvider',
)

import { createContext } from 'react'

import type { ToolTriggerMetadata } from '@/core/tools/schema'
import type { ToolId } from '@/core/tools/tool-registry'

export interface WorkbenchCommandHandlers {
  activateTool: (toolId: ToolId, metadata: ToolTriggerMetadata) => void | Promise<void>
  requestUndo: () => void
  requestRedo: () => void
  requestPartImport: () => void | Promise<void>
}

export const WorkbenchCommandContext = createContext<WorkbenchCommandHandlers | null>(null)

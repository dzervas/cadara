import type { ReactNode } from 'react'

import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_PX,
} from '@/components/cad/viewport-overlay-layout'

interface WorkbenchInspectorOverlayProps {
  children: ReactNode
}

export function WorkbenchInspectorOverlay({ children }: WorkbenchInspectorOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        className="pointer-events-auto absolute min-w-0 max-w-md"
        style={{
          left: VIEWPORT_FLOATING_PANEL_LEFT_PX,
          top: VIEWPORT_FLOATING_PANEL_TOP_PX,
        }}
      >
        {children}
      </div>
    </div>
  )
}

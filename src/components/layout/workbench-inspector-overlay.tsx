import type { ReactNode } from 'react'

interface WorkbenchInspectorOverlayProps {
  children: ReactNode
}

export function WorkbenchInspectorOverlay({ children }: WorkbenchInspectorOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="pointer-events-auto absolute left-3 top-3 min-w-0 max-w-full">
        {children}
      </div>
    </div>
  )
}

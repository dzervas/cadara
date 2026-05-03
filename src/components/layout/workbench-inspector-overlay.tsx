import type { ReactNode } from 'react'

interface WorkbenchInspectorOverlayProps {
  children: ReactNode
}

export function WorkbenchInspectorOverlay({ children }: WorkbenchInspectorOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="pointer-events-auto absolute left-[268px] top-[76px] min-w-0 max-w-md">
        {children}
      </div>
    </div>
  )
}

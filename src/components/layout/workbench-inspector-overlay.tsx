import type { ReactNode } from 'react'

interface WorkbenchInspectorOverlayProps {
  children: ReactNode
}

export function WorkbenchInspectorOverlay({ children }: WorkbenchInspectorOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-y-4 right-4 z-20 flex max-w-[calc(100%-2rem)] items-stretch justify-end">
      <div className="pointer-events-auto h-full max-w-full overflow-hidden rounded-xl shadow-[var(--workbench-panel-shadow)]">
        {children}
      </div>
    </div>
  )
}

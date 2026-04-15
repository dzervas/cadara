import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

export interface WorkbenchStateDebuggerRequirement {
  id: string
  label: string
  description: string
  slotCount: number
}

export interface WorkbenchStateDebuggerSelectionDetail {
  label: string
  kindLabel: string
  ownerLabel: string
  relatedLabels: readonly string[]
  targetLabel: string
}

export interface WorkbenchStateDebuggerModel {
  activeMode: string
  machineState: string
  command: string
  phase: string
  selectionCount: number
  selectionTargets: string
  revision: string
  snapshotDiagnosticsCount: number
  sketchSession: string
  sketchPlane: string
  featureSession: string
  previewState: string
  selectionFilterLabel: string
  activeTargetRule: string
  requirements: readonly WorkbenchStateDebuggerRequirement[]
  selectionDetail: WorkbenchStateDebuggerSelectionDetail
  hoverTarget: string
}

interface WorkbenchStateDebuggerProps {
  state: WorkbenchStateDebuggerModel
  defaultExpanded?: boolean
}

function DebuggerRow(props: { label: string; value: string | number }) {
  return (
    <div>
      {props.label}: <span className="text-[var(--cad-foreground)]">{props.value}</span>
    </div>
  )
}

export function WorkbenchStateDebugger({ state, defaultExpanded = false }: WorkbenchStateDebuggerProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 max-w-[360px] rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] px-3 py-2 text-xs text-[var(--cad-muted-foreground)] shadow-[var(--cad-panel-shadow)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--cad-muted)]">
            State Debugger
          </p>
          <p className="mt-1 text-[var(--cad-muted-foreground)]">
            {state.activeMode} / {state.machineState} / {state.command}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse state debugger' : 'Expand state debugger'}
          onClick={() => setIsExpanded((current) => !current)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--cad-border)] text-[var(--cad-muted-foreground)] transition hover:border-[var(--cad-border-strong)] hover:text-[var(--cad-foreground)]"
        >
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {isExpanded ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-1">
            <DebuggerRow label="Active mode" value={state.activeMode} />
            <DebuggerRow label="Machine" value={state.machineState} />
            <DebuggerRow label="Command" value={state.command} />
            <DebuggerRow label="Phase" value={state.phase} />
            <DebuggerRow label="Preview" value={state.previewState} />
            <DebuggerRow label="Selection" value={state.selectionCount} />
            <DebuggerRow label="Selection targets" value={state.selectionTargets} />
            <DebuggerRow label="Revision" value={state.revision} />
            <DebuggerRow label="Snapshot diagnostics" value={state.snapshotDiagnosticsCount} />
          </div>

          <div className="border-t border-[var(--cad-border)] pt-2">
            <DebuggerRow label="Sketch session" value={state.sketchSession} />
            <DebuggerRow label="Sketch plane" value={state.sketchPlane} />
            <DebuggerRow label="Feature session" value={state.featureSession} />
          </div>

          <div className="border-t border-[var(--cad-border)] pt-2">
            <DebuggerRow label="Selection filter" value={state.selectionFilterLabel} />
            <DebuggerRow label="Target rule" value={state.activeTargetRule} />
            <div className="mt-1 grid gap-1">
              {state.requirements.length > 0 ? (
                state.requirements.map((requirement) => (
                  <div key={requirement.id}>
                    <span className="text-[var(--cad-foreground)]">{requirement.label}</span>: {requirement.description}{' '}
                    <span className="text-[var(--cad-foreground)]">({requirement.slotCount} slots)</span>
                  </div>
                ))
              ) : (
                <div>No selection requirements.</div>
              )}
            </div>
          </div>

          <div className="border-t border-[var(--cad-border)] pt-2">
            <DebuggerRow label="Hover target" value={state.hoverTarget} />
            <DebuggerRow label="Selection detail" value={state.selectionDetail.label} />
            <DebuggerRow label="Kind" value={state.selectionDetail.kindLabel} />
            <DebuggerRow label="Owner" value={state.selectionDetail.ownerLabel} />
            <DebuggerRow
              label="Related"
              value={state.selectionDetail.relatedLabels.length > 0 ? state.selectionDetail.relatedLabels.join(', ') : 'none'}
            />
            <DebuggerRow label="Target" value={state.selectionDetail.targetLabel} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

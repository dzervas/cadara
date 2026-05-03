import { useState } from 'react'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import type { WorkbenchDebugState } from '@/domain/debug/debug-platform'

export type WorkbenchStateDebuggerModel = WorkbenchDebugState

interface WorkbenchStateDebuggerProps {
  state: WorkbenchStateDebuggerModel
  defaultExpanded?: boolean
  className?: string
}

function DebuggerRow(props: { label: string; value: string | number }) {
  return (
    <div>
      {props.label}: <span className="text-[var(--cad-foreground)]">{props.value}</span>
    </div>
  )
}

export function WorkbenchStateDebugger({
  state,
  defaultExpanded = false,
  className = '',
}: WorkbenchStateDebuggerProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const pointerPassthrough = isCadTestMode()

  return (
    <div
      className={`${className} max-w-[360px] rounded-lg border text-[10px] text-[var(--cad-muted)] shadow-[var(--workbench-shell-elevation-md)] ${
        pointerPassthrough ? 'pointer-events-none' : 'pointer-events-auto'
      }`}
      data-workbench-state-debugger
      data-expanded={isExpanded ? 'true' : 'false'}
      style={{
        backgroundColor: 'var(--workbench-debugger-surface)',
        borderColor: 'var(--workbench-glass-border)',
        fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      }}
    >
      <div
        className="flex items-center gap-2.5 px-2.5 py-2"
        style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}
      >
        <span className="font-semibold text-[var(--cad-muted-foreground)]">State Debugger</span>
        <span className="text-[var(--cad-muted)]" data-workbench-state-debugger-summary>
          {state.activeMode} / {state.machineState} / {state.command}
        </span>
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse state debugger' : 'Expand state debugger'}
          onClick={() => setIsExpanded((current) => !current)}
          className="ml-auto grid h-[18px] w-[18px] shrink-0 place-items-center rounded text-[var(--cad-foreground)] transition"
          style={{ backgroundColor: 'var(--workbench-debugger-chevron-bg)' }}
        >
          <WorkbenchIcon name={isExpanded ? 'chevronDown' : 'chevronRight'} className="h-3 w-3" />
        </button>
      </div>

      {isExpanded ? (
        <div
          className="grid gap-3 px-3 pb-3 pt-2 text-xs"
          style={{
            fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif",
            letterSpacing: 0,
            textTransform: 'none',
            color: 'var(--cad-muted-foreground)',
            borderTop: '1px solid var(--workbench-glass-divider)',
          }}
        >
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
            <DebuggerRow label="Section offset" value={state.sectionOffset ?? 'none'} />
            <DebuggerRow label="Section side" value={state.sectionRetainedSide ?? 'none'} />
          </div>

          <details className="border-t border-[var(--cad-border)] pt-2">
            <summary className="cursor-pointer text-[var(--cad-foreground)]">
              Topology naming
            </summary>
            <div className="mt-2 grid gap-2">
              <div className="grid gap-1">
                <DebuggerRow label="Bodies" value={state.topologyDebug.bodyCount} />
                <DebuggerRow label="Live topology refs" value={state.topologyDebug.liveTopologyReferences} />
                <DebuggerRow label="Invalid topology refs" value={state.topologyDebug.invalidatedTopologyReferences} />
              </div>

              <div className="grid gap-1">
                {state.topologyDebug.bodies.length > 0 ? (
                  state.topologyDebug.bodies.map((body) => (
                    <div key={body.bodyId}>
                      <span className="text-[var(--cad-foreground)]">{body.label}</span>: {body.faces}F/{body.edges}E/{body.vertices}V,{' '}
                      {body.liveReferences} live, {body.invalidatedReferences} invalid
                    </div>
                  ))
                ) : (
                  <div>No body topology.</div>
                )}
              </div>

              <div className="grid gap-1">
                {state.topologyDebug.invalidations.length > 0 ? (
                  state.topologyDebug.invalidations.map((invalidation) => (
                    <div key={invalidation.reason}>
                      <span className="text-[var(--cad-foreground)]">{invalidation.reason}</span>: {invalidation.count}
                      {invalidation.examples.length > 0 ? ` (${invalidation.examples.join(', ')})` : ''}
                    </div>
                  ))
                ) : (
                  <div>No topology invalidations.</div>
                )}
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  )
}

function isCadTestMode() {
  if (import.meta.env.TEST === true || import.meta.env.TEST === 'true') {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).has('cadTestMode')
}

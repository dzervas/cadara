import { forwardRef, useCallback, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ForwardedRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { Tooltip } from '@mantine/core'

import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import type { DocumentId } from '@/contracts/shared/ids'
import {
  workbenchTabsStorageDescriptor,
  type WorkbenchTab,
  type WorkbenchTabsState,
  type WorkbenchTabStorageKind,
} from '@/domain/workspace/workbench-tabs'

/**
 * Document tab strip anchored at the bottom of the viewport. The strip itself does not float;
 * its upward-cast shadow is what gives the history bar above it room to lift off.
 *
 * Visual contract — see DESIGN.md and the impeccable shape brief:
 *   - Active state is typographic (semibold, brightened) plus a 1px Workshop-Steel hairline
 *     riding the top edge of the tab.
 *   - Pending recompute reuses that same top edge as a 1.5px indeterminate sweep, so loading
 *     "becomes" the active hairline when the recompute resolves.
 *   - The leading glyph communicates *where the document lives* (browser-only / filesystem-bound
 *     / cloud) rather than dirty state, because CADara saves automatically.
 */
export interface DocumentTabsBarProps {
  state: WorkbenchTabsState
  /** Document currently mid-recompute. The active hairline becomes a sweep while present. */
  pendingDocumentId?: DocumentId | null
  /** Document whose last activation failed. The active hairline turns red. */
  errorDocumentId?: DocumentId | null
  onActivate: (documentId: DocumentId) => void
  onClose: (documentId: DocumentId) => void
  onReorder: (documentId: DocumentId, toIndex: number) => void
  onRename: (documentId: DocumentId, title: string) => void
}

/**
 * Imperative handle. Used by the workbench shell to ask the bar to enter rename mode for a
 * freshly-created tab. Imperative on purpose: rename-on-create is an event ("user just clicked
 * New document"), not derived state, and modeling it as a prop would mean either driving a
 * setState from a useEffect or threading a one-shot token. The handle keeps the seam local.
 */
export interface DocumentTabsBarHandle {
  requestRename(documentId: DocumentId): void
}

const TAB_HEIGHT_PX = 36
const TAB_MIN_WIDTH_PX = 96
const TAB_MAX_WIDTH_PX = 200
const DRAG_THRESHOLD_PX = 4
const TAB_GAP_PX = 18
const STRIP_PADDING_X_PX = 16

const stripStyle: CSSProperties = {
  height: TAB_HEIGHT_PX,
  paddingInline: STRIP_PADDING_X_PX,
  gap: TAB_GAP_PX,
  alignItems: 'stretch',
  backgroundColor: 'var(--workbench-shell-overlay-strong)',
  boxShadow: 'var(--workbench-shell-elevation-tabs)',
}

export const DocumentTabsBar = forwardRef(DocumentTabsBarComponent)

function DocumentTabsBarComponent(
  {
    state,
    pendingDocumentId = null,
    errorDocumentId = null,
    onActivate,
    onClose,
    onReorder,
    onRename,
  }: DocumentTabsBarProps,
  ref: ForwardedRef<DocumentTabsBarHandle>,
) {
  const tablistId = useId()
  const [draggingId, setDraggingId] = useState<DocumentId | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<DocumentId | null>(null)
  const dragStartXRef = useRef(0)

  const beginRename = useCallback((documentId: DocumentId) => {
    setEditingId(documentId)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      requestRename: (documentId: DocumentId) => {
        setEditingId(documentId)
      },
    }),
    [],
  )

  const commitRename = useCallback(
    (documentId: DocumentId, value: string) => {
      const trimmed = value.trim()
      if (trimmed.length > 0) {
        const previous = state.tabs.find((tab) => tab.documentId === documentId)?.title
        if (trimmed !== previous) {
          onRename(documentId, trimmed)
        }
      }
      setEditingId(null)
    },
    [onRename, state.tabs],
  )

  const cancelRename = useCallback(() => {
    setEditingId(null)
  }, [])

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, documentId: DocumentId) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', documentId)
      dragStartXRef.current = event.clientX
      setDraggingId(documentId)
    },
    [],
  )

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, index: number) => {
      if (draggingId === null) {
        return
      }
      if (Math.abs(event.clientX - dragStartXRef.current) < DRAG_THRESHOLD_PX) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDragOverIndex(index)
    },
    [draggingId],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, index: number) => {
      event.preventDefault()
      if (draggingId !== null) {
        onReorder(draggingId, index)
      }
      setDraggingId(null)
      setDragOverIndex(null)
    },
    [draggingId, onReorder],
  )

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    setDragOverIndex(null)
  }, [])

  return (
    <nav
      aria-label="Open documents"
      role="tablist"
      id={tablistId}
      data-workbench-document-tabs
      className="flex w-full shrink-0 select-none overflow-x-auto overflow-y-hidden"
      style={stripStyle}
    >
      {state.tabs.map((tab, index) => {
        const isActive = tab.documentId === state.activeDocumentId
        const isPending = pendingDocumentId === tab.documentId
        const hasError = errorDocumentId === tab.documentId
        const isDragging = draggingId === tab.documentId
        const isDropTarget = dragOverIndex === index && draggingId !== null && !isDragging

        return (
          <div
            key={tab.documentId}
            onDragOver={(event) => handleDragOver(event, index)}
            onDrop={(event) => handleDrop(event, index)}
            className="relative flex shrink-0"
            style={{
              transform: isDropTarget ? 'translateX(8px)' : undefined,
              transition: 'transform 160ms cubic-bezier(0.25, 1, 0.5, 1)',
            }}
            data-document-tab-slot
            data-active={isActive ? 'true' : undefined}
            data-pending={isPending ? 'true' : undefined}
          >
            <DocumentTabButton
              tab={tab}
              index={index}
              total={state.tabs.length}
              isActive={isActive}
              isPending={isPending}
              hasError={hasError}
              isDragging={isDragging}
              isEditing={editingId === tab.documentId}
              onActivate={onActivate}
              onClose={onClose}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onBeginRename={beginRename}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
            />
          </div>
        )
      })}
    </nav>
  )
}

interface DocumentTabButtonProps {
  tab: WorkbenchTab
  index: number
  total: number
  isActive: boolean
  isPending: boolean
  hasError: boolean
  isDragging: boolean
  isEditing: boolean
  onActivate: (documentId: DocumentId) => void
  onClose: (documentId: DocumentId) => void
  onDragStart: (event: DragEvent<HTMLButtonElement>, documentId: DocumentId) => void
  onDragEnd: () => void
  onBeginRename: (documentId: DocumentId) => void
  onCommitRename: (documentId: DocumentId, title: string) => void
  onCancelRename: () => void
}

function DocumentTabButton({
  tab,
  index,
  total,
  isActive,
  isPending,
  hasError,
  isDragging,
  isEditing,
  onActivate,
  onClose,
  onDragStart,
  onDragEnd,
  onBeginRename,
  onCommitRename,
  onCancelRename,
}: DocumentTabButtonProps) {
  const [isHover, setIsHover] = useState(false)
  const closeOnly = total <= 1
  const showClose = !closeOnly && (isHover || isActive)
  const tooltipDescription = workbenchTabsStorageDescriptor(tab.storageKind, tab.storageDescriptor)
  const tooltipTitle = tab.title

  const handleClick = useCallback(() => {
    if (isEditing) {
      return
    }
    if (!isActive) {
      onActivate(tab.documentId)
    }
  }, [isActive, isEditing, onActivate, tab.documentId])

  const handleTitleDoubleClick = useCallback(
    (event: MouseEvent<HTMLSpanElement>) => {
      event.stopPropagation()
      event.preventDefault()
      if (!isActive) {
        onActivate(tab.documentId)
      }
      onBeginRename(tab.documentId)
    },
    [isActive, onActivate, onBeginRename, tab.documentId],
  )

  const handleAuxClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      // Middle-click closes
      if (event.button === 1 && !closeOnly) {
        event.preventDefault()
        onClose(tab.documentId)
      }
    },
    [closeOnly, onClose, tab.documentId],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      // Closing via keyboard mirrors macOS / browsers: hit the close button itself
      // for now. Cmd/Ctrl+W lives at the workbench shortcut layer.
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!isActive) {
          onActivate(tab.documentId)
        }
      }
    },
    [isActive, onActivate, tab.documentId],
  )

  const tabStyle: CSSProperties = {
    height: TAB_HEIGHT_PX,
    minWidth: TAB_MIN_WIDTH_PX,
    maxWidth: TAB_MAX_WIDTH_PX,
    paddingInline: 4,
    gap: 8,
    color: isActive ? 'var(--workbench-shell-text)' : 'var(--workbench-shell-text-dim)',
    fontWeight: isActive ? 500 : 500,
    cursor: isActive ? 'default' : 'pointer',
    opacity: isDragging ? 0.55 : 1,
    transition: 'color 120ms cubic-bezier(0.25, 1, 0.5, 1), opacity 120ms cubic-bezier(0.25, 1, 0.5, 1)',
  }

  return (
    <Tooltip
      label={<ToolbarTooltipContent title={tooltipTitle} description={tooltipDescription} />}
      position="top"
      offset={6}
      disabled={isEditing}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-controls={undefined}
        aria-label={`${tab.title} (${tooltipDescription})`}
        tabIndex={isActive ? 0 : -1}
        draggable={!closeOnly && !isEditing}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        onFocus={() => setIsHover(true)}
        onBlur={() => setIsHover(false)}
        onDragStart={(event) => onDragStart(event, tab.documentId)}
        onDragEnd={onDragEnd}
        data-document-tab
        data-document-id={tab.documentId}
        data-position={index}
        className="relative flex items-center gap-2 text-[13px] outline-none"
        style={tabStyle}
      >
        <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center" aria-hidden="true">
          <StorageGlyph kind={tab.storageKind} active={isActive || isHover} />
        </span>
        {isEditing ? (
          <DocumentTabTitleEditor
            initialValue={tab.title}
            onCommit={(value) => onCommitRename(tab.documentId, value)}
            onCancel={onCancelRename}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-left"
            style={{ letterSpacing: '-0.005em' }}
            onDoubleClick={handleTitleDoubleClick}
            data-document-tab-title
          >
            {tab.title}
          </span>
        )}
        {showClose && !isEditing ? (
          <span
            role="button"
            aria-label={`Close ${tab.title}`}
            tabIndex={-1}
            onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
              event.stopPropagation()
              event.preventDefault()
              onClose(tab.documentId)
            }}
            className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px]"
            style={{
              color: 'var(--workbench-shell-text-muted)',
              transition: 'background-color 120ms cubic-bezier(0.25, 1, 0.5, 1)',
            }}
            data-document-tab-close
            onMouseEnter={(event) => {
              event.currentTarget.style.backgroundColor = 'var(--workbench-shell-control-surface)'
              event.currentTarget.style.color = 'var(--workbench-shell-text)'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.backgroundColor = 'transparent'
              event.currentTarget.style.color = 'var(--workbench-shell-text-muted)'
            }}
          >
            <CloseGlyph />
          </span>
        ) : (
          <span aria-hidden="true" className="inline-flex h-[18px] w-[18px] shrink-0" />
        )}
        <ActiveOrPendingHairline isActive={isActive} isPending={isPending} hasError={hasError} />
      </button>
    </Tooltip>
  )
}

/**
 * The 1px hairline along the top edge of an active tab, which doubles as the recompute
 * loading sweep. The same line carries three meanings, distinguished only by animation:
 *   - default active: a static Workshop-Steel hairline.
 *   - pending: a 1.5px segment translating left-to-right (`workbench-tab-loading-sweep`).
 *   - error: a static red hairline.
 */
function ActiveOrPendingHairline({
  isActive,
  isPending,
  hasError,
}: {
  isActive: boolean
  isPending: boolean
  hasError: boolean
}) {
  if (!isActive && !isPending) {
    return null
  }

  if (isPending) {
    return (
      <span
        aria-hidden="true"
        data-tab-hairline="pending"
        className="pointer-events-none absolute -bottom-px left-[-6px] right-[-6px] h-[2px] overflow-hidden"
        style={{ borderTopLeftRadius: 1, borderTopRightRadius: 1 }}
      >
        <span
          className="absolute inset-y-0 w-[36%]"
          style={{
            backgroundColor: 'var(--workbench-shell-accent)',
            animation: 'workbench-tab-loading-sweep 1100ms cubic-bezier(0.25, 1, 0.5, 1) infinite',
          }}
        />
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      data-tab-hairline={hasError ? 'error' : 'active'}
      className="pointer-events-none absolute -bottom-px left-[-6px] right-[-6px] h-[2px]"
      style={{
        backgroundColor: hasError
          ? 'var(--workbench-shell-danger-border)'
          : 'var(--workbench-shell-text-muted)',
        borderTopLeftRadius: 1,
        borderTopRightRadius: 1,
      }}
    />
  )
}

function StorageGlyph({ kind, active }: { kind: WorkbenchTabStorageKind; active: boolean }) {
  // Active tabs render their storage glyph in spark-orange — the third Spark Affordance
  // (see DESIGN.md). Inactive tabs stay graphite.
  const tone = active ? 'var(--workbench-spark-accent)' : 'var(--workbench-shell-text-dim)'

  switch (kind) {
    case 'browser':
      // 6px filled circle: the document only lives in this browser's IndexedDB.
      return (
        <svg viewBox="0 0 14 14" width="14" height="14" data-storage-glyph="browser">
          <circle cx="7" cy="7" r="3" fill={tone} />
        </svg>
      )
    case 'filesystem':
      // Tiny linked-file: a document with a chain link, communicating "synced to disk".
      return (
        <svg viewBox="0 0 14 14" width="14" height="14" data-storage-glyph="filesystem" fill="none" stroke={tone} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 2.4h5.2L11 5v5.2a1.4 1.4 0 0 1-1.4 1.4H3a1.4 1.4 0 0 1-1.4-1.4V3.8A1.4 1.4 0 0 1 3 2.4Z" />
          <path d="M8 2.6V5h2.6" />
          <path d="M5.2 8.6h3.6" />
        </svg>
      )
    case 'cloud':
      return (
        <svg viewBox="0 0 14 14" width="14" height="14" data-storage-glyph="cloud" fill="none" stroke={tone} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 10.4h6.2a2.6 2.6 0 0 0 .3-5.18 3.4 3.4 0 0 0-6.55-.84A2.6 2.6 0 0 0 4 10.4Z" />
        </svg>
      )
  }
}

interface DocumentTabTitleEditorProps {
  initialValue: string
  onCommit: (value: string) => void
  onCancel: () => void
}

/**
 * Inline rename input. Replaces the title span while the tab is in edit mode.
 *
 * Behavior:
 *   - Mounts focused, with the title pre-selected so typing replaces immediately.
 *   - Enter / blur commit; Escape cancels.
 *   - Empty values cancel rather than committing — a tab can't be nameless.
 *   - The input is structurally inert to the surrounding `<button role="tab">`:
 *     pointer events stop bubbling so dragging the title text doesn't initiate a tab drag,
 *     and Enter/Space don't re-trigger the tab's keyboard activate handler.
 */
function DocumentTabTitleEditor({ initialValue, onCommit, onCancel }: DocumentTabTitleEditorProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus()
    input.select()
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      maxLength={256}
      onChange={(event) => setValue(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit(value)
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => onCommit(value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
      data-document-tab-title-editor
      aria-label="Rename document"
      className="min-w-0 flex-1 bg-transparent text-left outline-none"
      style={{
        color: 'var(--workbench-shell-text)',
        fontWeight: 500,
        letterSpacing: '-0.005em',
        boxShadow: 'inset 0 -1px 0 0 var(--workbench-shell-text-muted)',
        padding: '0 1px',
      }}
    />
  )
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

import type { PrimitiveRef } from '@/core/editor/schema'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import type { WorkbenchContextMenuEntry } from '@/components/layout/workbench-context-menu'

export function getPartsObjectMenuEntries(input: {
  canChangeSketchPlane: boolean
  label: string
  onChangeSketchPlaneTarget?: (target: Extract<PrimitiveRef, { kind: 'sketch' }>) => void
  onObjectDelete: (target: PrimitiveRef, label: string) => void
  onObjectExport: (target: PrimitiveRef, label: string) => void
  onRenameTarget: (target: PrimitiveRef, label: string) => void
  target: PrimitiveRef
}): WorkbenchContextMenuEntry[] {
  const {
    canChangeSketchPlane,
    label,
    onChangeSketchPlaneTarget,
    onObjectDelete,
    onObjectExport,
    onRenameTarget,
    target,
  } = input

  return [
    {
      kind: 'item',
      id: 'rename',
      label: 'Rename',
      commandId: 'context.rename',
      icon: <WorkbenchIcon name="type" className="h-3.5 w-3.5" />,
      onSelect: () => onRenameTarget(target, label),
    },
    ...(target.kind === 'sketch' && canChangeSketchPlane && onChangeSketchPlaneTarget
      ? [{
          kind: 'item' as const,
          id: 'change-sketch-plane',
          label: 'Change Sketch Plane',
          icon: <WorkbenchIcon name="edit" className="h-3.5 w-3.5" />,
          onSelect: () => onChangeSketchPlaneTarget(target),
        }]
      : []),
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete',
      commandId: 'context.delete',
      icon: <WorkbenchIcon name="trash" className="h-3.5 w-3.5" />,
      danger: true,
      onSelect: () => onObjectDelete(target, label),
    },
    {
      kind: 'item',
      id: 'export',
      label: 'Export',
      commandId: 'context.export',
      icon: <WorkbenchIcon name="download" className="h-3.5 w-3.5" />,
      onSelect: () => onObjectExport(target, label),
    },
  ]
}

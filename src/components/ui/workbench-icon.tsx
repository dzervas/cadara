import type { CSSProperties } from 'react'

export type WorkbenchIconName =
  | 'ban'
  | 'box'
  | 'check'
  | 'chevronDown'
  | 'chevronRight'
  | 'close'
  | 'component'
  | 'download'
  | 'edit'
  | 'eyeClosed'
  | 'eyeOpen'
  | 'history'
  | 'info'
  | 'keyboard'
  | 'layers'
  | 'mousePointer'
  | 'pencilRuler'
  | 'plus'
  | 'ruler'
  | 'search'
  | 'slider'
  | 'target'
  | 'trash'
  | 'type'

const workbenchIconAssetMap: Record<WorkbenchIconName, string> = {
  ban: 'cancel.svg',
  box: 'part.svg',
  check: 'check_mark.svg',
  chevronDown: 'dropdown-arrow.svg',
  chevronRight: 'arrow-right.svg',
  close: 'close.svg',
  component: 'composite-part.svg',
  download: 'export.svg',
  edit: 'edit.svg',
  eyeClosed: 'eye_closed.svg',
  eyeOpen: 'eye_open.svg',
  history: 'revision-history.svg',
  info: 'info.svg',
  keyboard: 'keyboard-search-empty.svg',
  layers: 'structure-view.svg',
  mousePointer: 'Select.svg',
  pencilRuler: 'sketch.svg',
  plus: 'plus.svg',
  ruler: 'sketch-dimension.svg',
  search: 'search.svg',
  slider: 'slider.svg',
  target: 'dimension-origin.svg',
  trash: 'trash.svg',
  type: 'markup-text.svg',
}

interface WorkbenchIconProps {
  name: WorkbenchIconName
  className?: string
  size?: number
  style?: CSSProperties
}

export function WorkbenchIcon({ name, className, size, style }: WorkbenchIconProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        backgroundColor: 'currentColor',
        display: 'inline-block',
        height: size,
        maskImage: `url(/icons/${workbenchIconAssetMap[name]})`,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        maskSize: 'contain',
        width: size,
        ...style,
      }}
    />
  )
}

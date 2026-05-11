import type { CSSProperties } from "react";

export type WorkbenchIconName =
  | "ban"
  | "box"
  | "check"
  | "chevronDown"
  | "chevronRight"
  | "close"
  | "component"
  | "discord"
  | "download"
  | "edit"
  | "error"
  | "eyeClosed"
  | "eyeOpen"
  | "file"
  | "flipDirection"
  | "github"
  | "history"
  | "info"
  | "import"
  | "keyboard"
  | "layers"
  | "mousePointer"
  | "newDocument"
  | "pencilRuler"
  | "plus"
  | "reportBug"
  | "ruler"
  | "search"
  | "slider"
  | "target"
  | "trash"
  | "type"
  | "variables"
  | "warning";

const workbenchIconAssetMap: Record<WorkbenchIconName, string> = {
  ban: "cancel.svg",
  box: "part.svg",
  check: "check_mark.svg",
  chevronDown: "dropdown-arrow.svg",
  chevronRight: "arrow-right.svg",
  close: "close.svg",
  component: "composite-part.svg",
  discord: "discord-logo.svg",
  download: "export.svg",
  edit: "edit.svg",
  error: "error.svg",
  eyeClosed: "eye_closed.svg",
  eyeOpen: "eye_open.svg",
  file: "document.svg",
  flipDirection: "flip-direction.svg",
  github: "GitHub-logo.svg",
  history: "revision-history.svg",
  info: "info.svg",
  import: "document-upload.svg",
  keyboard: "keyboard-search-empty.svg",
  layers: "structure-view.svg",
  mousePointer: "Select.svg",
  newDocument: "add-new.svg",
  pencilRuler: "sketch.svg",
  plus: "plus.svg",
  reportBug: "bug.svg",
  ruler: "sketch-dimension.svg",
  search: "search.svg",
  slider: "slider.svg",
  target: "dimension-origin.svg",
  trash: "trash.svg",
  type: "markup-text.svg",
  variables: "variable-table.svg",
  warning: "warning-overlay.svg",
};

interface WorkbenchIconProps {
  name: WorkbenchIconName;
  className?: string;
  size?: number;
  style?: CSSProperties;
}

export function WorkbenchIcon({
  name,
  className,
  size,
  style,
}: WorkbenchIconProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        backgroundColor: "currentColor",
        display: "inline-block",
        height: size,
        maskImage: `url(/icons/${workbenchIconAssetMap[name]})`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        width: size,
        ...style,
      }}
    />
  );
}

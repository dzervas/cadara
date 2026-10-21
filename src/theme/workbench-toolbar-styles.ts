import type { CSSProperties } from "react";

export const toolbarActionIconClassName = "workbench-toolbar-action";
export const sparkLogoClassName = "workbench-spark-logo";

interface ToolbarActionIconStyleOptions {
  active?: boolean;
  success?: boolean;
}

type ToolbarActionIconStyle = CSSProperties &
  Partial<Record<`--workbench-toolbar-action-${string}`, string>>;

export function getToolbarActionIconStyle({
  active = false,
  success = false,
}: ToolbarActionIconStyleOptions = {}): ToolbarActionIconStyle {
  const hoverBackground = success
    ? "var(--workbench-shell-success-surface)"
    : active
      ? "var(--workbench-shell-accent-surface-hover)"
      : "var(--workbench-toolbar-button-hover-background)";
  const hoverBorder = success
    ? "var(--workbench-shell-success-border)"
    : active
      ? "var(--workbench-shell-accent)"
      : "var(--workbench-toolbar-button-hover-border)";

  return {
    "--workbench-toolbar-action-hover-bg": hoverBackground,
    "--workbench-toolbar-action-hover-border": hoverBorder,
    "--workbench-toolbar-action-press-bg": success
      ? "var(--workbench-shell-success-surface)"
      : "var(--workbench-toolbar-button-press-background)",
  };
}

/** Shared by family and island dropdown triggers so they measure alike. */
export const toolbarDropdownTriggerLayoutStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  gap: 4,
  height: 40,
  paddingInline: 10,
  width: "auto",
};

export const toolbarDropdownMenuStyle: CSSProperties = {
  backgroundColor: "var(--workbench-shell-overlay-strong)",
  border: "none",
  boxShadow: "var(--workbench-shell-elevation-md)",
};

export function getToolbarDropdownTriggerStyle({
  active,
  disabled,
}: {
  active: boolean;
  disabled: boolean;
}) {
  return {
    ...getToolbarActionIconStyle({ active }),
    "--workbench-toolbar-action-bg": disabled
      ? "var(--workbench-shell-control-surface)"
      : active
        ? "var(--workbench-shell-accent-surface)"
        : "transparent",
    "--workbench-toolbar-action-border": active
      ? "var(--workbench-shell-accent)"
      : "transparent",
    "--workbench-toolbar-action-color": disabled
      ? "var(--workbench-shell-text-dim)"
      : "var(--workbench-shell-text)",
    ...toolbarDropdownTriggerLayoutStyle,
    opacity: disabled ? 0.46 : 1,
  };
}

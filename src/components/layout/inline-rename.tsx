import { useRef } from "react";

export interface InlineRenameSession {
  targetKey: string;
  onCommit: (label: string) => void;
  onCancel: () => void;
}

/** The variable-row editing pattern, shared by object and history labels. */
export function InlineRenameInput({
  label,
  onCommit,
  onCancel,
}: {
  label: string;
  onCommit: (label: string) => void;
  onCancel: () => void;
}) {
  // Enter/Escape unmount the input and may also cause blur. Finish only once.
  const finished = useRef(false);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    if (value === null) onCancel();
    else onCommit(value);
  };

  return (
    <input
      aria-label={`Rename ${label}`}
      autoFocus
      defaultValue={label}
      className="h-7 min-w-0 flex-1 rounded border bg-[var(--workbench-shell-overlay)] px-2 text-[13px] font-medium text-[var(--workbench-shell-text)] outline-none focus:border-[var(--workbench-shell-accent)]"
      style={{ borderColor: "var(--workbench-shell-border)" }}
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          finish(event.key === "Escape" ? null : event.currentTarget.value);
        }
      }}
    />
  );
}

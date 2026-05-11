import type { SketchToolFloatingInputDescriptor } from "@/core/sketch-tools/editor-schema";

interface SketchFloatingInputProps {
  descriptor: SketchToolFloatingInputDescriptor | null | undefined;
  onPatch: (patch: Record<string, unknown>) => void;
}

export function SketchFloatingInput({
  descriptor,
  onPatch,
}: SketchFloatingInputProps) {
  if (!descriptor) {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 z-10 w-[220px] -translate-x-1/2 rounded-xl border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-3 text-xs text-[var(--cad-muted-foreground)] shadow-[var(--cad-panel-shadow)]">
      <div className="text-sm font-medium text-[var(--cad-foreground)]">
        {descriptor.label}
      </div>
      <input
        autoFocus
        className="mt-2 h-9 w-full rounded-md border border-[var(--cad-border)] bg-[var(--cad-surface)] px-2 font-mono text-[13px] text-[var(--cad-foreground)] outline-none focus-visible:border-[var(--cad-accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cad-accent)]"
        defaultValue={descriptor.value?.toString() ?? ""}
        key={descriptor.id}
        min={descriptor.min}
        step="any"
        type="number"
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value);
          onPatch({
            value: Number.isNaN(nextValue) ? null : nextValue,
          });
        }}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex-1 rounded-md border border-[var(--cad-border)] px-2 py-1 text-[var(--cad-foreground)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cad-accent)]"
          onClick={() => onPatch(descriptor.cancelAction.patch)}
        >
          {descriptor.cancelLabel}
        </button>
        <button
          type="button"
          className="flex-1 rounded-md border border-[var(--cad-border-strong)] bg-[var(--cad-surface-elevated)] px-2 py-1 text-[var(--cad-foreground)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cad-accent)]"
          onClick={() => onPatch(descriptor.submitAction.patch)}
        >
          {descriptor.confirmLabel}
        </button>
      </div>
    </div>
  );
}

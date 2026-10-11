/**
 * T16a ([TECH] T16-2): the Mirror selection-context panel (in the shared
 * left column, `sketch-selection-context.tsx`). T16e: with the replace
 * actions.
 */

import { Button } from "@mantine/core";

import { SketchSelectionContextPanel } from "@/components/cad/sketch-selection-context";
import type { SketchMirrorActionEntry } from "@/domain/editor/sketch-session";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** What Remove deletes and what it leaves broken, before the click. */
function mirrorRemovalConsequence(entry: SketchMirrorActionEntry) {
  const requirements =
    entry.requirementCount === 0
      ? ""
      : `, ${plural(entry.requirementCount, "requirement", "requirements")} on the copies${
          entry.sizingRequirementCount === 0
            ? ""
            : `, ${entry.sizingRequirementCount} of which currently ${entry.sizingRequirementCount === 1 ? "sizes" : "size"} the originals`
        }`;
  const broken =
    entry.brokenDownstreamLabels.length === 0
      ? ""
      : ` Leaves ${entry.brokenDownstreamLabels.map((label) => `‘${label}’`).join(", ")} broken.`;
  return `Removes ${plural(entry.copyCount, "copy", "copies")}${requirements}.${broken}`;
}

export interface SketchMirrorActionsProps {
  entries: readonly SketchMirrorActionEntry[];
  onRemove: (derivationId: string) => void;
  /** T16e: Replace mirror line… (the line) / Replace original… (that copy's). */
  onReplace: (derivationId: string, outputEntityId: string | null) => void;
}

/**
 * Per mirror: its label, health, Replace mirror line…, Replace original…
 * (T16e; when the entry targets a copy), Remove mirror and the
 * consequence line.
 */
export function SketchMirrorActions({
  entries,
  onRemove,
  onReplace,
}: SketchMirrorActionsProps) {
  return (
    <SketchSelectionContextPanel title="Mirror" testId="sketch-mirror-actions">
      {entries.map((entry) => (
        <div
          key={entry.derivationId}
          className="grid gap-1"
          data-mirror-derivation-id={entry.derivationId}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--workbench-shell-text)]">
              {entry.label}
            </span>
            <span
              className={
                entry.brokenReason === null
                  ? undefined
                  : "text-[var(--workbench-shell-danger-text)]"
              }
            >
              {entry.brokenReason === null
                ? "Healthy"
                : `Broken: ${entry.brokenReason}`}
            </span>
          </div>
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => onReplace(entry.derivationId, null)}
            data-testid="mirror-replace-line"
          >
            Replace mirror line…
          </Button>
          {entry.replaceOriginalOutputId === null ? null : (
            <Button
              size="compact-xs"
              variant="default"
              onClick={() =>
                onReplace(entry.derivationId, entry.replaceOriginalOutputId)
              }
              data-testid="mirror-replace-original"
            >
              Replace original…
            </Button>
          )}
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => onRemove(entry.derivationId)}
            data-testid="mirror-remove"
          >
            Remove mirror
          </Button>
          <p>{mirrorRemovalConsequence(entry)}</p>
        </div>
      ))}
    </SketchSelectionContextPanel>
  );
}

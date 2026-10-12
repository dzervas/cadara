/**
 * T17c ([TECH] T17-5): the Offset selection-context panel (in the shared
 * left column, `sketch-selection-context.tsx`; the T16a Mirror panel
 * pattern).
 */

import { Button } from "@mantine/core";

import { SketchSelectionContextPanel } from "@/components/cad/sketch-selection-context";
import type { SketchOffsetActionEntry } from "@/domain/editor/sketch-session";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** What Remove deletes and what it leaves broken, before the click (T16a R-8 wording). */
function offsetRemovalConsequence(entry: SketchOffsetActionEntry) {
  const requirements =
    entry.requirementCount === 0
      ? ""
      : `, ${plural(entry.requirementCount, "requirement", "requirements")} on the offset curves${
          entry.sizingRequirementCount === 0
            ? ""
            : `, ${entry.sizingRequirementCount} of which currently ${entry.sizingRequirementCount === 1 ? "sizes" : "size"} the originals`
        }`;
  const broken =
    entry.brokenDownstreamLabels.length === 0
      ? ""
      : ` Leaves ${entry.brokenDownstreamLabels.map((label) => `‘${label}’`).join(", ")} broken.`;
  // Review A-4: every output already deleted.
  if (entry.outputCount === 0 && requirements === "")
    return `Removes the broken offset.${broken}`;
  return `Removes ${plural(entry.outputCount, "offset curve", "offset curves")}${requirements}.${broken}`;
}

export interface SketchOffsetActionsProps {
  entries: readonly SketchOffsetActionEntry[];
  onRemove: (derivationId: string) => void;
}

/**
 * Per offset: its label and health (review R-1: "Broken: ‹reason›" with
 * its recovery), Remove offset and the consequence line.
 */
export function SketchOffsetActions({
  entries,
  onRemove,
}: SketchOffsetActionsProps) {
  return (
    <SketchSelectionContextPanel title="Offset" testId="sketch-offset-actions">
      {entries.map((entry) => (
        <div
          key={entry.derivationId}
          className="grid gap-1"
          data-offset-derivation-id={entry.derivationId}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--workbench-shell-text)]">
              {entry.label}
            </span>
            {entry.health.kind === "broken" ? null : (
              <span>
                {entry.health.kind === "healthy" ? "Healthy" : "Checking…"}
              </span>
            )}
          </div>
          {entry.health.kind === "broken" ? (
            <p className="text-[var(--workbench-shell-danger-text)]">
              {`Broken: ${entry.health.reason}. Undo, or remove the offset.`}
            </p>
          ) : null}
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => onRemove(entry.derivationId)}
            data-testid="offset-remove"
          >
            Remove offset
          </Button>
          <p>{offsetRemovalConsequence(entry)}</p>
        </div>
      ))}
    </SketchSelectionContextPanel>
  );
}

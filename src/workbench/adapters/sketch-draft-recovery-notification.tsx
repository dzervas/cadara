import { Button, Group } from "@mantine/core";
import type { PersistedSketchDraft } from "@/contracts/sketch/draft-recovery";
import { WorkbenchNotification } from "@/components/layout/workbench-notification";

export function SketchDraftRecoveryNotification({ draft, onResume, onDiscard }: {
  draft: PersistedSketchDraft; onResume: () => void; onDiscard: () => void;
}) {
  return <WorkbenchNotification type="warning" title="Recover sketch draft" message={<>
    Unfinished changes to {draft.label} are available. They stay private until Finish.
    <Group gap="xs" mt="xs" className="pointer-events-auto">
      <Button size="xs" variant="default" onClick={onResume}>Resume</Button>
      <Button size="xs" variant="subtle" onClick={onDiscard}>Discard</Button>
    </Group>
  </>} />;
}

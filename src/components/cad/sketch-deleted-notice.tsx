/**
 * T17-20 (T17k2; T17b0 P-8 S1): the notice shown while editing a sketch
 * another session deleted, first in the shared left column
 * (`sketch-selection-context.tsx`). Finish can't publish it, so the one way
 * out is an explicit, confirmed "Discard changes and leave".
 */

import { Button } from "@mantine/core";
import { useState } from "react";

import { SketchSelectionContextPanel } from "@/components/cad/sketch-selection-context";

export interface SketchDeletedNoticeProps {
  message: string;
  onDiscard: () => void;
}

export interface SketchDeletedNoticeViewProps extends SketchDeletedNoticeProps {
  /** The discard was asked for and waits for its confirmation. */
  confirming: boolean;
  onAsk: () => void;
  onKeepEditing: () => void;
}

export function SketchDeletedNoticeView({
  message,
  confirming,
  onAsk,
  onKeepEditing,
  onDiscard,
}: SketchDeletedNoticeViewProps) {
  return (
    <SketchSelectionContextPanel
      title="Sketch deleted"
      testId="sketch-deleted-notice"
    >
      <p role="alert" className="text-[var(--workbench-shell-text)]">
        {message}
      </p>
      {confirming ? (
        <div className="grid gap-2">
          <p>Your changes in this sketch will be lost.</p>
          <div className="flex gap-2">
            <Button size="xs" color="red" onClick={onDiscard}>
              Discard changes and leave
            </Button>
            <Button size="xs" variant="default" onClick={onKeepEditing}>
              Keep editing
            </Button>
          </div>
        </div>
      ) : (
        <Button size="xs" variant="default" onClick={onAsk}>
          Discard changes and leave…
        </Button>
      )}
    </SketchSelectionContextPanel>
  );
}

export function SketchDeletedNotice(props: SketchDeletedNoticeProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <SketchDeletedNoticeView
      {...props}
      confirming={confirming}
      onAsk={() => setConfirming(true)}
      onKeepEditing={() => setConfirming(false)}
    />
  );
}

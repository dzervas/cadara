import { Progress, Stack, Text } from "@mantine/core";
import type {
  LoadingPhase,
  LoadingProgress,
} from "@/contracts/modeling/loading-status";

const sentences: Record<Exclude<LoadingPhase, "ready">, string> = {
  "preparing-engine": "Preparing the geometry engine.",
  "opening-document": "Opening the document.",
  "preparing-geometry": "Preparing geometry.",
  failed: "Unable to prepare the document.",
};

// The accent at full strength over a faint accent track: the stripes this
// replaced (15% white over light gray, 4px tall) were imperceptible (cadara-ku5k).
const trackColor = "color-mix(in oklch, var(--workbench-shell-accent) 22%, transparent)";
const barColor = "var(--workbench-shell-accent)";

const progressSentences: Record<LoadingProgress["stage"], string> = {
  "rebuilding-features": "Rebuilding features.",
  "downloading-engine": "Downloading the geometry engine.",
};

/** Visible text and the bar's aria-valuetext for a measured stage. */
function describeProgress({ stage, completed, total, label }: LoadingProgress) {
  if (stage === "downloading-engine") {
    const percent = `${Math.floor((completed / total) * 100)}%`;
    return { text: `Downloading the geometry engine ${percent}`, valueText: percent };
  }
  const count = `Rebuilding features ${completed}/${total}`;
  return {
    text: label === null ? count : `${count} · ${label}`,
    valueText: `${completed} of ${total} features`,
  };
}

export function InitialLoadingStatus({
  phase,
  progress = null,
}: {
  phase: LoadingPhase;
  progress?: LoadingProgress | null;
}) {
  if (phase === "ready") return null;
  // A measured total of zero has nothing to count ("0/0").
  const measured = phase !== "failed" && progress && progress.total > 0 ? progress : null;
  // The live region names the stage only, so screen readers are not handed a
  // new announcement per feature; the count lives in the bar's aria-valuetext.
  const sentence = measured ? progressSentences[measured.stage] : sentences[phase];
  const description = measured ? describeProgress(measured) : null;
  return (
    <Stack
      gap="xs"
      w={240}
      role="status"
      aria-live="polite"
      aria-label={sentence}
    >
      {description ? (
        <>
          <Text size="sm" c="dimmed" truncate="end" aria-hidden="true">
            {description.text}
          </Text>
          <span className="sr-only">{sentence}</span>
        </>
      ) : (
        <Text size="sm" c="dimmed" truncate="end">
          {sentence}
        </Text>
      )}
      {phase === "failed" ? null : measured && description ? (
        <Progress.Root
          size={4}
          bg={trackColor}
          role="progressbar"
          aria-label={sentence}
          aria-valuemin={0}
          aria-valuemax={measured.total}
          aria-valuenow={measured.completed}
          aria-valuetext={description.valueText}
          data-loading-progress="determinate"
        >
          <Progress.Section
            value={(measured.completed / measured.total) * 100}
            color={barColor}
            withAria={false}
          />
        </Progress.Root>
      ) : (
        // Unknown duration: a sweeping segment shows activity only, never a
        // measured completion. It animates a transform, so the compositor
        // keeps it moving even while the main thread is busy.
        <Progress.Root
          size={4}
          bg={trackColor}
          role="progressbar"
          aria-label={sentence}
          data-loading-progress="indeterminate"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-[36%]"
            style={{
              backgroundColor: barColor,
              animation:
                "workbench-tab-loading-sweep 1100ms cubic-bezier(0.25, 1, 0.5, 1) infinite",
            }}
          />
        </Progress.Root>
      )}
    </Stack>
  );
}

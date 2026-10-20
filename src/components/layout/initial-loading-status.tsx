import { Progress, Stack, Text } from "@mantine/core";
import type { LoadingPhase } from "@/contracts/modeling/loading-status";

const sentences: Record<Exclude<LoadingPhase, "ready">, string> = {
  "preparing-engine": "Preparing the geometry engine.",
  "opening-document": "Opening the document.",
  "preparing-geometry": "Preparing geometry.",
  failed: "Unable to prepare the document.",
};

export function InitialLoadingStatus({ phase }: { phase: LoadingPhase }) {
  if (phase === "ready") return null;
  const sentence = sentences[phase];
  return (
    <Stack
      gap="xs"
      w={240}
      role="status"
      aria-live="polite"
      aria-label={sentence}
    >
      <Text size="sm" c="dimmed">
        {sentence}
      </Text>
      {phase !== "failed" ? (
        // Full-width stripes indicate activity only, not measured completion.
        <Progress.Root size={4} role="progressbar" aria-label={sentence}>
          <Progress.Section
            value={100}
            striped
            animated
            color="gray"
            withAria={false}
          />
        </Progress.Root>
      ) : null}
    </Stack>
  );
}

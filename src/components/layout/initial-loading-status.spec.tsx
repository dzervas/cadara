import { expect, test } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { InitialLoadingStatus } from "./initial-loading-status";
import { OpenDocumentModal } from "./document-file-menu";
import type {
  LoadingPhase,
  LoadingProgress,
} from "@/contracts/modeling/loading-status";

function render(phase: LoadingPhase, progress: LoadingProgress | null = null) {
  return renderToStaticMarkup(
    <MantineProvider>
      <InitialLoadingStatus phase={phase} progress={progress} />
    </MantineProvider>,
  );
}

/** Markup minus aria-hidden leaf elements: what a live region can announce. */
function withoutHidden(markup: string) {
  return markup.replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>[^<]*<\/\1>/g, "");
}

for (const [phase, sentence] of [
  ["preparing-engine", "Preparing the geometry engine."],
  ["opening-document", "Opening the document."],
  ["preparing-geometry", "Preparing geometry."],
] as const) {
  test(`${phase} announces one sentence and an indeterminate accessible bar`, () => {
    const markup = render(phase);
    expect(markup).toContain(sentence);
    expect(markup).toContain('role="status"');
    expect(markup).toContain(`aria-label="${sentence}"`);
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain("aria-valuenow");
    expect(markup).not.toContain("aria-valuetext");
    // A transform sweep (compositor-driven), not the imperceptible stripes.
    expect(markup).toContain('data-loading-progress="indeterminate"');
    expect(markup).toContain("workbench-tab-loading-sweep");
    expect(markup).not.toContain("data-striped");
  });
}

test("measured feature rebuild progress names the stage, count and feature with a determinate bar (cadara-ku5k)", () => {
  const markup = render("preparing-geometry", {
    stage: "rebuilding-features",
    completed: 6,
    total: 24,
    label: "Extrude 7",
  });
  expect(markup).toContain("Rebuilding features 6/24 · Extrude 7");
  // The live region and the bar name the stage only; the per-feature count
  // and name are visible text hidden from assistive tech, so screen readers
  // are not handed an announcement per feature.
  expect(markup).toContain('role="status" aria-live="polite" aria-label="Rebuilding features."');
  expect(markup).toContain('role="progressbar" aria-label="Rebuilding features."');
  expect(markup).toMatch(/aria-hidden="true"[^>]*>Rebuilding features 6\/24 · Extrude 7</);
  expect(withoutHidden(markup)).not.toContain("6/24");
  expect(withoutHidden(markup)).not.toContain("Extrude 7");
  expect(withoutHidden(markup)).toContain(">Rebuilding features.<");
  expect(markup).toContain('data-loading-progress="determinate"');
  expect(markup).toContain('aria-valuemin="0"');
  expect(markup).toContain('aria-valuemax="24"');
  expect(markup).toContain('aria-valuenow="6"');
  expect(markup).toContain('aria-valuetext="6 of 24 features"');
  expect(markup).toContain("--progress-section-size:25%");
  expect(markup).not.toContain("Preparing geometry.");
  const done = render("preparing-geometry", {
    stage: "rebuilding-features",
    completed: 24,
    total: 24,
    label: null,
  });
  expect(done).toContain("Rebuilding features 24/24<");
  expect(render("failed", {
    stage: "rebuilding-features",
    completed: 3,
    total: 24,
    label: "Extrude 4",
  })).toContain("Unable to prepare the document.");
});

test("a measured total of zero falls back to the phase sentence, never a 0/0 count (cadara-ku5k)", () => {
  const markup = render("preparing-geometry", {
    stage: "rebuilding-features",
    completed: 0,
    total: 0,
    label: null,
  });
  expect(markup).not.toContain("0/0");
  expect(markup).toContain("Preparing geometry.");
  expect(markup).toContain('data-loading-progress="indeterminate"');
});

test("ready removes status and failed stops activity while retaining a short failure sentence", () => {
  expect(render("ready")).not.toContain('role="status"');
  const failed = render("failed");
  expect(failed).toContain("Unable to prepare the document.");
  expect(failed).not.toContain('role="progressbar"');
});

test("slow document file reads show their status inside the open modal", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <OpenDocumentModal
        opened
        withinPortal={false}
        loadingPhase="opening-document"
        onClose={() => {}}
        onOpenCopy={() => {}}
        onOpenLinked={() => {}}
      />
    </MantineProvider>,
  );
  expect(markup).toContain("Opening the document.");
  expect(markup).toContain('role="progressbar"');
});

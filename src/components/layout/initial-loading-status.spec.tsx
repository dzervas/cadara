import { expect, test } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { InitialLoadingStatus } from "./initial-loading-status";
import { OpenDocumentModal } from "./document-file-menu";
import type { LoadingPhase } from "@/contracts/modeling/loading-status";

function render(phase: LoadingPhase) {
  return renderToStaticMarkup(
    <MantineProvider>
      <InitialLoadingStatus phase={phase} />
    </MantineProvider>,
  );
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
  });
}

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

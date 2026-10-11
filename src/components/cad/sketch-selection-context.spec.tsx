/**
 * T16a ([TECH] T16-22, review R-1): the left floating panel column. UI lane;
 * seam: the rendered markup of `SketchSelectionContextStack` with the
 * validation status and the Mirror and Tangent panels (structural: one
 * positioned column, flow order status → Mirror → Tangent, nothing
 * positioned on its own, so no two overlap).
 */
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { SketchMirrorActions } from "./sketch-mirror-actions";
import {
  SketchSelectionContextStack,
  SketchValidationStatus,
} from "./sketch-selection-context";
import { SketchTangentActions } from "./sketch-tangent-actions";

test("T16a (T16-22, R-1): the validation status, Mirror and Tangent flow in one positioned column; none is positioned on its own", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchSelectionContextStack>
        <SketchValidationStatus message="Mirror ‘mirror 3’ is broken." />
        <SketchMirrorActions
          entries={[
            {
              derivationId: "derivation_broken",
              label: "mirror 3",
              brokenReason: "mirror line missing",
              copyCount: 1,
              requirementCount: 0,
              sizingRequirementCount: 0,
              brokenDownstreamLabels: [],
              replaceOriginalOutputId: null,
            },
          ]}
          onRemove={() => {}}
          onReplace={() => {}}
        />
        <SketchTangentActions
          resetEnabled
          zeroEnabled
          onReset={() => {}}
          onZero={() => {}}
        />
      </SketchSelectionContextStack>
    </MantineProvider>,
  );
  const openingTags = markup.match(/<[a-z]+ [^>]*>/g) ?? [];
  const positioned = openingTags.filter((tag) =>
    /class="[^"]*\b(absolute|fixed)\b/.test(tag),
  );
  expect(positioned, "exactly one positioned element").toHaveLength(1);
  expect(positioned[0]).toContain(
    'data-testid="sketch-selection-context-stack"',
  );
  expect(positioned[0]).toMatch(/class="[^"]*\bflex-col\b/);
  const stack = markup.indexOf("sketch-selection-context-stack");
  const status = markup.indexOf('role="status"');
  const mirror = markup.indexOf('data-testid="sketch-mirror-actions"');
  const tangent = markup.indexOf('data-testid="sketch-tangent-actions"');
  expect(stack).toBeGreaterThan(-1);
  expect(status, "the status is inside the column, first").toBeGreaterThan(
    stack,
  );
  expect(mirror, "Mirror below the status").toBeGreaterThan(status);
  expect(tangent, "Tangent below Mirror").toBeGreaterThan(mirror);
});

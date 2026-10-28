import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchToolPanel } from "@/components/cad/sketch-tool-panel";
import { SketchValidationStatus } from "@/components/cad/sketch-selection-context";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  finalizeSketchDraw,
  getSketchToolPresentation,
  selectSketchEditToolTarget,
  startSketchDraw,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";
import {
  PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
  SPLINE_SLOT_UNSUPPORTED_MESSAGE,
} from "@/core/sketch-editing/operations";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";

// Lane: UI (docs/testing.md). Seam: the panel renders the edit tool's
// validation message from the session's tool presentation (T10h, D6): Slot
// along a spline and the static offset of a projected spline are refused
// with an explicit "not supported yet" message the user sees.
test("tool refusals render once across the tool panel and session status", () => {
  // A fit-point spline commits when it is finalized (T11i).
  const drawn = finalizeSketchDraw(
    acceptSketchDraw(
      acceptSketchDraw(
        startSketchDraw(
          beginSketchTool(
            withSketchSnapScale(
              enterSketchSession(
                createNewSketchSessionFromSupport(
                  {
                    kind: "construction",
                    constructionId: "construction_plane-xy",
                  },
                  OCC_KERNEL_SETTINGS,
                ),
              ),
              SPEC_SKETCH_UNITS_PER_PIXEL,
            ),
            "spline",
          ),
          [0, 0],
        ),
        [1, 2],
      ),
      [2, 0],
    ),
  );
  const spline = drawn.definition.entities.find(
    (entity) => entity.kind === "spline",
  )!;
  const slot = selectSketchEditToolTarget(
    beginSketchTool(drawn, "sketchSlot"),
    spline.target,
  );
  const offset = selectSketchEditToolTarget(
    beginSketchTool(
      {
        ...drawn,
        projectedReferences: [
          {
            referenceId: "ref_projected_spline",
            status: "projected",
            geometry: [
              {
                geometryId: "projected_geometry_spline",
                kind: "spline",
                representation: {
                  kind: "sourceSamples",
                  points: [
                    [0, 0],
                    [1, 2],
                    [2, 0],
                  ],
                  isClosed: false,
                },
              },
            ],
            diagnostics: [],
          },
        ] as SketchSessionState["projectedReferences"],
      },
      "offset",
    ),
    {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_projected_spline",
      geometryId: "projected_geometry_spline",
      geometryKind: "spline",
    } as never,
  );
  for (const [session, message] of [
    [slot, SPLINE_SLOT_UNSUPPORTED_MESSAGE],
    [offset, PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE],
  ] as const) {
    const schema = getSketchToolPresentation(session);
    expect(session.validationMessage, "the tool is the only diagnostic owner").toBeNull();
    const markup = renderToStaticMarkup(
      <MantineProvider>
        <SketchToolPanel schema={schema} onPatch={() => undefined} />
        <SketchValidationStatus
          message={session.validationMessage ?? ""}
        />
      </MantineProvider>,
    );
    expect(markup.split(message).length - 1, `Show "${message}" once.`).toBe(1);
  }
});

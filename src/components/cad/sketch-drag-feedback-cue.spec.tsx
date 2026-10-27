import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchDragFeedbackCue } from "@/components/cad/sketch-drag-feedback-cue";
import {
  acceptSketchDraw,
  beginSketchGeometryDrag,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  finishSketchGeometryDrag,
  clearActiveSketchTool,
  startSketchDraw,
  updateSketchGeometryDrag,
} from "@/domain/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/definition-authoring";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";

// UI lane: the local refusal must not turn into a second global status on release.
test("a fixed-point refusal stays local instead of repeating on release", () => {
  const drawn = acceptSketchDraw(
    startSketchDraw(
      beginSketchTool(
        enterSketchSession(
          createNewSketchSessionFromSupport(
            { kind: "construction", constructionId: "construction_plane-xy" },
            OCC_KERNEL_SETTINGS,
          ),
        ),
        "line",
      ),
      [0, 0],
    ),
    [4, 0],
  );
  const point = drawn.definition.points[0]!;
  const session = rebuildSessionForDefinition(clearActiveSketchTool(drawn), {
    definition: {
      ...drawn.definition,
      constraintIds: ["constraint_fixed_point"],
      constraints: [
        {
          constraintId: "constraint_fixed_point",
          kind: "fixPoint",
          label: "Fix",
          pointId: point.pointId,
          position: point.position,
        },
      ],
    },
  });
  const dragging = updateSketchGeometryDrag(
    beginSketchGeometryDrag(session, point.target, point.position),
    [3, 3],
  );
  const feedback = dragging.activeDrag?.feedback;
  expect(feedback?.kind).toBe("constrained");
  const markup = renderToStaticMarkup(
    <SketchDragFeedbackCue cue={{ x: 200, y: 150, text: feedback!.text }} />,
  );
  expect(markup.split(feedback!.text)).toHaveLength(2);
  expect(
    finishSketchGeometryDrag(dragging, [3, 3]).validationMessage,
  ).toBeNull();
});

/**
 * T12f UI-lane test for the sketch drag feedback cue.
 *
 * Lane: UI
 * Seam: SketchDragFeedbackCue conditional rendering
 * Why: `docs/testing.md` assigns presentational rendering to the UI lane
 */

test("T12f: drag feedback cue renders at the projected position with the diagnostic text when present", () => {
  const markup = renderToStaticMarkup(
    <SketchDragFeedbackCue
      cue={{
        x: 200,
        y: 150,
        text: "Geometry is constrained and cannot move to that position.",
      }}
    />,
  );
  expect(
    markup.includes('data-testid="sketch-drag-feedback-cue"'),
    "The cue element should render with the test id.",
  ).toBe(true);
  expect(
    markup.includes("left:200px"),
    "The cue should be positioned at the projected X.",
  ).toBe(true);
  expect(
    markup.includes("top:150px"),
    "The cue should be positioned at the projected Y.",
  ).toBe(true);
  expect(
    markup.includes("Geometry is constrained"),
    "The cue should display the diagnostic text.",
  ).toBe(true);
});

test("T12f: drag feedback cue is hidden when feedback is null", () => {
  const markup = renderToStaticMarkup(<SketchDragFeedbackCue cue={null} />);
  expect(
    markup.includes('data-testid="sketch-drag-feedback-cue"'),
    "The cue element should NOT render when feedback is null.",
  ).toBe(false);
});

test("T12f: drag feedback cue is non-interactive (pointer-events-none)", () => {
  const markup = renderToStaticMarkup(
    <SketchDragFeedbackCue cue={{ x: 100, y: 100, text: "Constrained." }} />,
  );
  expect(
    markup.includes("pointer-events-none"),
    "The cue should be pointer-events-none so canvas clicks pass through.",
  ).toBe(true);
});

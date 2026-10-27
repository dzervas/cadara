import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { SketchToolPanel } from "@/components/cad/sketch-tool-panel";
import { SketchViewportFeedbackLayer } from "@/components/cad/sketch-viewport-feedback";
import {
  acceptSketchDraw,
  startSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  selectSketchEditToolTarget,
  patchSketchEditToolValue,
  getSketchToolPresentation,
} from "@/domain/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { offsetSession } from "@/domain/editor/sketch-offset.fixtures";
import {
  beginSketchAnnotationEdit,
  patchSketchAnnotationEditValue,
} from "@/domain/editor/sketch-session/annotation-editing";
import { collectSketchViewportFeedbackAnchors } from "./sketch-viewport-feedback-model";

// UI lane: the session's invalid Offset parameter is red in both editing
// surfaces, and returning to a valid number clears the field error (O29).
test("O29: Offset marks its panel and floating inputs invalid until the value is valid", () => {
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
    [10, 0],
  );
  const selected = selectSketchEditToolTarget(
    beginSketchTool(drawn, "offset"),
    drawn.definition.entities[0]!.target,
  );
  const invalid = patchSketchEditToolValue(selected, { value: "0" });
  const recovered = patchSketchEditToolValue(invalid, { value: "0.5" });
  for (const [session, hasError] of [
    [invalid, true],
    [recovered, false],
  ] as const) {
    const schema = getSketchToolPresentation(session)!;
    for (const surface of [
      <SketchToolPanel schema={schema} onPatch={() => undefined} />,
      <SketchViewportFeedbackLayer
        schema={schema}
        projections={[
          { id: "floating-input:offset-distance-input", x: 180, y: 90 },
        ]}
        onPatch={() => undefined}
      />,
    ]) {
      const markup = renderToStaticMarkup(
        <MantineProvider>{surface}</MantineProvider>,
      );
      const input = markup
        .match(/<input[^>]*>/g)!
        .find((tag) => !tag.includes('type="hidden"'))!;
      expect(input.includes('aria-invalid="true"'), input).toBe(hasError);
      expect(markup.includes("var(--workbench-shell-danger-border)")).toBe(
        hasError,
      );
    }
  }
});

test("a committed offset distance exposes the shared floating expression input with a projected anchor", () => {
  const { session, relationship } = offsetSession("circle");
  const edited = patchSketchAnnotationEditValue(
    beginSketchAnnotationEdit(session, { kind: "offsetDistance", derivationId: relationship.derivationId }),
    { value: "2*depth" },
  );
  const schema = getSketchToolPresentation(edited)!;
  const input = schema.floatingInput!;
  expect(input.numericOnly).not.toBe(true);
  expect(collectSketchViewportFeedbackAnchors(schema)).toContainEqual({ id: `floating-input:${input.id}`, anchor: input.anchor });
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchViewportFeedbackLayer schema={schema} projections={[{ id: `floating-input:${input.id}`, x: 180, y: 90 }]} onPatch={() => {}} />
    </MantineProvider>,
  );
  expect(markup).toContain(`data-sketch-viewport-floating-input="${input.id}"`);
  expect(markup).toContain("Offset distance");
  expect(markup).toContain('value="2*depth"');
});

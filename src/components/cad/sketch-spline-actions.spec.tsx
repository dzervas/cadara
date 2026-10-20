import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SketchSplineActions } from "./sketch-spline-actions";
import { SketchSpecialModePanel } from "./sketch-special-mode-panel";
import type { SketchSpecialModePanelSchema } from "@/core/sketch-special-modes/schema";

const closeSpline = { entityId: "spline_1", label: "Spline 1", refusal: null };
const tangent = { visible: true, resetEnabled: true, zeroEnabled: true };

test("close-spline and tangent actions share one existing prompt/options panel", () => {
  const tree = SketchSplineActions({
    closeSpline,
    tangent,
    onPatch: () => {},
  })!;
  expect(tree.type).toBe(SketchSpecialModePanel);
  expect(tree.props.inline).toBe(true);
  const markup = renderToStaticMarkup(
    <MantineProvider>{tree}</MantineProvider>,
  );
  expect(markup.match(/<aside/g)).toHaveLength(1);
  for (const label of ["Close spline", "Reset to automatic", "Set to zero"])
    expect(markup).toContain(label);
  for (const id of [
    "sketch-close-spline-action",
    "sketch-tangent-actions",
    "spline-close",
    "tangent-reset",
    "tangent-zero",
  ])
    expect(markup).toContain(`data-testid="${id}"`);
});

test("all actions retain their command intents", () => {
  const patches: Record<string, unknown>[] = [];
  const tree = SketchSplineActions({
    closeSpline,
    tangent,
    onPatch: (patch) => patches.push(patch),
  })!;
  for (const section of tree.props.schema.sections)
    for (const button of section.buttons!) tree.props.onAction(button.action);
  expect(patches).toEqual([
    { intent: "closeSpline" },
    { intent: "resetTangentToAutomatic" },
    { intent: "setTangentToZero" },
  ]);
});

test("refused actions stay visible and disabled with the close-spline explanation", () => {
  const tree = SketchSplineActions({
    closeSpline: { ...closeSpline, refusal: "Spline 1 cannot close." },
    tangent: { ...tangent, resetEnabled: false, zeroEnabled: false },
    onPatch: () => {},
  })!;
  const schema: SketchSpecialModePanelSchema = tree.props.schema;
  expect(
    schema.sections
      .flatMap((section) => section.buttons)
      .every((button) => button?.disabled),
  ).toBe(true);
  const markup = renderToStaticMarkup(
    <MantineProvider>{tree}</MantineProvider>,
  );
  expect(markup).toContain("Spline 1 cannot close.");
  expect(markup.match(/<button[^>]* disabled/g)).toHaveLength(3);
  expect(
    SketchSplineActions({
      closeSpline: null,
      tangent: null,
      onPatch: () => {},
    }),
  ).toBeNull();
});

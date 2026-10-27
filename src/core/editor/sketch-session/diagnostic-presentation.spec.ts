import { expect, test } from "vitest";
import { drawnMixedOutlineSession } from "@/application/editor/sketch-action-owner.fixtures";
import { getSketchSessionDiagnosticPresentation } from "./diagnostic-presentation";

// Logic lane: session diagnostics retain one source and link only explicitly named geometry.
test("a withheld-region diagnostic links its named geometry and hides query internals", () => {
  const session = drawnMixedOutlineSession();
  const entity = session.definition.entities[0]!;
  const message = "The declared-join query is uncertain (kernel-internals).";
  session.validationMessage = `${message} No region is formed there. Undo, or edit that geometry.`;
  session.liveRegions = {
    ...session.liveRegions,
    diagnostics: [
      {
        code: "region-join-uncertain",
        severity: "warning",
        message,
        target: { kind: "entity", entityId: entity.entityId },
      },
    ],
  };
  expect(getSketchSessionDiagnosticPresentation(session)).toEqual({
    message: `The join near ‘${entity.label}’ cannot form a region.`,
    severity: "warning",
    target: entity.target,
  });
  expect(session.validationMessage).toContain("kernel-internals");
});

test("a self-intersection refusal is a simple error with an explicit geometry link", () => {
  const session = drawnMixedOutlineSession();
  const entity = session.definition.entities.find(
    (entry) => entry.kind === "spline",
  )!;
  const message = `The self-intersection query of ‘${entity.label}’ is unsupported (technical-code): details`;
  session.validationMessage = `${message} No region is formed there. Undo, or edit that geometry.`;
  session.liveRegions = {
    ...session.liveRegions,
    diagnostics: [
      {
        code: "region-query-unsupported",
        severity: "warning",
        message,
        target: { kind: "entity", entityId: entity.entityId },
      },
    ],
  };
  expect(getSketchSessionDiagnosticPresentation(session)).toEqual({
    message: `Cannot resolve self-intersections near ‘${entity.label}’. No region is formed.`,
    severity: "error",
    target: entity.target,
  });
});

test("an unrelated message never borrows a diagnostic's geometry or warning severity", () => {
  const session = drawnMixedOutlineSession();
  session.validationMessage = "Cannot finish the sketch.";
  expect(getSketchSessionDiagnosticPresentation(session)).toEqual({
    message: "Cannot finish the sketch.",
    severity: "error",
    target: null,
  });
  session.validationMessage = null;
  expect(getSketchSessionDiagnosticPresentation(session)).toBeNull();
});

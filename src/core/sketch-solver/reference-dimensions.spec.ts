import { expect, test } from "vitest";
import {
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
} from "./solver-test-seams";
import { solveSketchDefinitionCore } from "./solve-sketch";
import type { DimensionDefinition } from "@/contracts/sketch/schema";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { literalResolvedDefinition } from "@/contracts/sketch/region-extraction.fixtures";
import {
  makeReferenceDimensionCases,
  makeReferenceDimensionSketch,
  withDimensions,
} from "@/contracts/sketch/reference-dimension.fixtures";
// T13d (D10), logic lane, solver-core seam: a reference dimension compiles
// no residual, reports `driven` with the measured quantity in the driving
// status' units and sign convention (null plus an info diagnostic when the
// quantity is undefined) and never counts against acceptance. Rows run in
// the multi-entity reference-dimension sketch.

const TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
};

function solve(dimensions: readonly DimensionDefinition[]) {
  return solveSketchDefinitionCore({
    // T17p2 (F-2): the solver consumes the resolved definition.
    definition: literalResolvedDefinition(
      withDimensions(makeReferenceDimensionSketch(), dimensions),
    ),
    tolerances: TOLERANCES,
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  });
}

test("T13d D10: every numeric reference kind reads driven with its measured value; an undefined quantity is null with one info diagnostic", () => {
  const cases = makeReferenceDimensionCases();
  const solved = solve(cases.map((entry) => entry.reference));
  expect(solved.status.solveState).toBe("solved");
  expect(
    solved.solvedSnapshot.diagnostics.filter(
      (diagnostic) => diagnostic.severity !== "info",
    ),
    "a reference never yields a warning or an error",
  ).toEqual([]);
  for (const entry of cases) {
    const status = solved.solvedSnapshot.dimensionStatuses.find(
      (candidate) => candidate.dimensionId === entry.reference.dimensionId,
    );
    expect(status?.status, entry.name).toBe("driven");
    if (entry.measured === null) {
      expect(status?.solvedValue, entry.name).toBeNull();
    } else {
      expect(status?.solvedValue, entry.name).toBeCloseTo(entry.measured, 9);
    }
  }
  expect(
    solved.solvedSnapshot.diagnostics
      .filter(
        (diagnostic) => diagnostic.code === "reference-dimension-undefined",
      )
      .map((diagnostic) => [diagnostic.severity, diagnostic.target]),
    "exactly the undefined quantity gets an info diagnostic",
  ).toEqual(
    cases
      .filter((entry) => entry.measured === null)
      .map((entry) => [
        "info",
        { kind: "dimension", dimensionId: entry.reference.dimensionId },
      ]),
  );

  // The driving twins report the same values under the same convention.
  const driving = solve(
    cases
      .filter((entry) => entry.measured !== null)
      .map((entry) => entry.driving),
  );
  for (const entry of cases.filter((candidate) => candidate.measured !== null))
    expect(
      driving.solvedSnapshot.dimensionStatuses.find(
        (candidate) => candidate.dimensionId === entry.driving.dimensionId,
      ),
      `${entry.name}: the driving twin`,
    ).toMatchObject({ status: "driving" });
});

test("T13d D10: a reference dimension compiles no residual; its driving twin does", () => {
  const sketch = makeReferenceDimensionSketch();
  for (const entry of makeReferenceDimensionCases()) {
    const evaluate = (dimension: DimensionDefinition) => {
      const definition = literalResolvedDefinition(
        withDimensions(sketch, [dimension]),
      );
      return () =>
        evaluateSketchScalarConstraintForTest({
          definition,
          constraintId: dimension.dimensionId,
          values: getSketchSolveInitialValuesForTest(
            definition,
            TOLERANCES,
            1e-3,
          ),
          tolerances: TOLERANCES,
          modelingTolerance: 1e-3,
        });
    };
    // (A driving line distance between non-parallel lines is not admitted.)
    if (entry.measured !== null)
      expect(evaluate(entry.driving), entry.name).not.toThrow();
    expect(evaluate(entry.reference), entry.name).toThrow(
      /Unknown scalar constraint/,
    );
  }
});

test("T13d D10: a sketch over-determined only by a reference stays solved and unmoved; the same value as driving conflicts", () => {
  const cases = makeReferenceDimensionCases();
  const radius = cases.find((entry) => entry.name === "circleRadius")!.driving;
  const diameter = cases.find((entry) => entry.name === "diameter (circle)")!;
  const bottom = cases.find((entry) => entry.name === "lineLength")!;
  const width = cases.find((entry) => entry.name === "distance horizontal")!;
  // Radius 2 drives the circle; bottom length 4 and a–b horizontal 4 drive
  // the bottom. The reference diameter and the reference second width are
  // determined by them.
  const withReferences = solve([
    radius,
    bottom.driving,
    diameter.reference,
    width.reference,
  ]);
  expect(withReferences.status.solveState).toBe("solved");
  expect(
    withReferences.solvedSnapshot.dimensionStatuses.map((entry) => [
      entry.dimensionId,
      entry.status,
    ]),
  ).toEqual([
    [radius.dimensionId, "driving"],
    [bottom.driving.dimensionId, "driving"],
    [diameter.reference.dimensionId, "driven"],
    [width.reference.dimensionId, "driven"],
  ]);
  const circle = withReferences.solvedSnapshot.solvedEntities.find(
    (entity) => entity.entityId === "sketch_entity_circle",
  );
  expect(circle?.kind === "circle" && circle.solvedRadius).toBeCloseTo(2, 9);

  // Premise: the same requirement as driving with another value conflicts,
  // so the solved result above is due to the reference compiling nothing.
  const conflicting = solve([
    radius,
    bottom.driving,
    { ...diameter.driving, value: createLiteralAuthoredValue(5) },
  ]);
  expect(conflicting.status.solveState).toBe("partiallySolved");
});

// D9′ (review A-2): a reference that kept a (stale or merged) value is still
// only measured: the value never drives, displays or reaches the status.
test("T13d D9′: a reference keeping a conflicting value is ignored by the solve", () => {
  const cases = makeReferenceDimensionCases();
  const radius = cases.find((entry) => entry.name === "circleRadius")!.driving;
  const diameter = cases.find((entry) => entry.name === "diameter (circle)")!;
  const solved = solve([
    radius,
    { ...diameter.reference, value: createLiteralAuthoredValue(99) },
  ]);
  expect(solved.status.solveState).toBe("solved");
  expect(solved.solvedSnapshot.dimensionStatuses[1]).toMatchObject({
    status: "driven",
    solvedValue: expect.closeTo(4, 9),
  });
});

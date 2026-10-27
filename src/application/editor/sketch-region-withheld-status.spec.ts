/**
 * T17c6 (D-2; specification "Minimum failure feedback"; issue 08: uncertainty
 * blocks consumption with geometry-linked diagnostics). Logic lane. Seam:
 * the sketch session's status line (`validationMessage`, what the workbench
 * shows) set when the live region derivation publishes, reached through the
 * authored-action owner around the real reducer on an entered session
 * (`createSketchActionOwnerFixture`; the derivation runs through the real
 * solver adapter with certified neutral-curve queries). A region-extraction
 * warning that withholds a region the sketch had, or leaves a closed outline
 * without one, is shown there with a recovery, not only in the preview
 * label. An uncertain join on an open chain (no region expected) stays off
 * the status line.
 */
import { describe, expect, test } from "vitest";
import type { SketchPointId } from "@/contracts/shared/ids";
import { validateSolvedSketchSnapshot } from "@/contracts/sketch/runtime-schema";
import type {
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import { pointRef } from "@/domain/editor/sketch-mirror.fixtures";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  getSketchSessionPreviewLabel,
  startSketchDraw,
} from "@/domain/editor/sketch-session";
import { publishSketchLiveRegions } from "@/domain/editor/sketch-session/session-live-solve";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/definition-authoring";
import { SPEC_SKETCH_UNITS_PER_PIXEL } from "@/domain/editor/sketch-session/test-snap-scale";
import { describeSketchSessionWithheldRegions } from "@/domain/editor/sketch-session/region-feedback";
import { createCertifiedNeutralCurveQuery } from "@/core/modeling/neutral-curve-certification/query";
import {
  createSketchActionOwnerFixture,
  drawnMixedOutlineSession,
  MIXED_OUTLINE,
} from "./sketch-action-owner.fixtures";

type Spline = Extract<SketchEntityDefinition, { kind: "spline" }>;
const splineOf = (definition: SketchDefinition) =>
  definition.entities.find(
    (entity): entity is Spline => entity.kind === "spline",
  )!;
const world = ([x, y]: readonly [number, number]) => [x, y, 0] as never;

/** The spline's first end tangent (at the arc join) authored as exactly zero. */
function withZeroStartTangent(definition: SketchDefinition): SketchDefinition {
  return {
    ...definition,
    entities: definition.entities.map((entity) =>
      entity.kind !== "spline"
        ? entity
        : {
            ...entity,
            pointOccurrences: entity.pointOccurrences.map(
              (occurrence, index) =>
                index === 0
                  ? {
                      ...occurrence,
                      tangent: { kind: "authored" as const, vector: [0, 0] },
                    }
                  : occurrence,
            ),
          },
    ),
  };
}

const ZERO_JOIN_TEXT =
  "The declared-join query of ‘3-point arc 2’ and ‘Spline 3’ span 1 is uncertain (join-zero-end-tangent): A cubic has a zero tangent at a declared join location. Affects ‘Spline 3’ start handle. No region is formed there. Undo, drag the handle out of zero, or Reset to automatic.";

describe("T17c6 D-2: a withheld region is explained on the status line", () => {
  test("the spline's end handle at the arc join dragged to exactly zero: one action, the region vanishes and the status explains it (label-based, with Undo); selecting a point keeps it; Undo brings the region back and clears it", async () => {
    const f = await createSketchActionOwnerFixture(drawnMixedOutlineSession());
    expect(f.session.liveRegions.status, "premise: one region").toBe("current");
    expect(f.session.liveRegions.regions).toHaveLength(1);
    expect(f.session.validationMessage, "premise: no status").toBeNull();
    const spline = splineOf(f.session.definition);
    const start = spline.pointOccurrences[0]!;
    const { M0 } = MIXED_OUTLINE;
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target: {
        kind: "sketchTangentHandle",
        sketchId: spline.target.sketchId,
        entityId: spline.entityId,
        occurrenceId: start.occurrenceId,
        pointId: start.pointId as SketchPointId,
      },
      point: world([M0[0] - 0.4, M0[1] + 0.3]),
    });
    f.dispatch({
      type: "sketch.geometryDragMoved",
      point: world([M0[0] - 0.2, M0[1] + 0.15]),
    });
    f.dispatch({
      type: "sketch.geometryDragMoved",
      point: world(M0),
      exactZero: true,
    });
    f.dispatch({
      type: "sketch.geometryDragEnded",
      point: world(M0),
      exactZero: true,
    });
    await f.settle();
    expect(f.undoLabels()).toEqual(["Move Sketch Geometry"]);
    expect(
      splineOf(f.session.definition).pointOccurrences[0]!.tangent,
      "premise: exactly zero",
    ).toEqual({ kind: "authored", vector: [0, 0] });
    expect(
      f.session.liveRegions.status,
      "the derivation is current: the region is withheld (fails closed), not pending",
    ).toBe("current");
    expect(f.session.liveRegions.regions, "the region vanished").toEqual([]);
    expect(f.session.liveRegions.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "region-join-uncertain",
          joinCause: {
            code: "join-zero-end-tangent",
            culprit: {
              kind: "splineTangentHandle",
              entityId: spline.entityId,
              occurrenceId: start.occurrenceId,
              pointId: start.pointId,
            },
          },
        }),
      ]),
    );
    expect(f.session.validationMessage, "the status line explains it").toBe(
      ZERO_JOIN_TEXT,
    );
    expect(getSketchSessionPreviewLabel(f.session)).toBe(ZERO_JOIN_TEXT);

    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, start.pointId as SketchPointId),
    });
    expect(
      f.session.validationMessage,
      "selecting a point keeps the explanation",
    ).toBe(ZERO_JOIN_TEXT);

    f.dispatch({ type: "history.undoRequested" });
    await f.settle();
    expect(
      f.session.liveRegions.regions,
      "Undo: the region is back",
    ).toHaveLength(1);
    expect(f.session.validationMessage, "and the status is clear").toBeNull();
  });

  test("a closed outline entered with that zero end tangent has no region: the status explains it from the start", async () => {
    const drawn = drawnMixedOutlineSession();
    const f = await createSketchActionOwnerFixture(
      rebuildSessionForDefinition(drawn, {
        definition: withZeroStartTangent(drawn.definition),
      }),
    );
    expect(f.session.liveRegions.status).toBe("current");
    expect(f.session.liveRegions.regions, "no region").toEqual([]);
    expect(f.session.validationMessage).toBe(ZERO_JOIN_TEXT);
    const spline = splineOf(f.session.definition);
    const start = spline.pointOccurrences[0]!;
    f.dispatch({
      type: "viewport.selectionRequested",
      target: {
        kind: "sketchTangentHandle",
        sketchId: spline.target.sketchId,
        entityId: spline.entityId,
        occurrenceId: start.occurrenceId,
        pointId: start.pointId,
      },
    });
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "resetTangentToAutomatic" },
    });
    await f.settle();
    expect(splineOf(f.session.definition).pointOccurrences[0]!.tangent.kind).toBe(
      "automatic",
    );
    expect(f.session.liveRegions.regions).toHaveLength(1);
    expect(f.session.validationMessage).toBeNull();
  });

  test.each([false, true])(
    "typed handle ownership survives region pair order (reverse entities: %s) and strict snapshot validation",
    async (reverse) => {
      const drawn = drawnMixedOutlineSession();
      const zero = withZeroStartTangent(drawn.definition);
      const f = await createSketchActionOwnerFixture(
        rebuildSessionForDefinition(drawn, {
          definition: {
            ...zero,
            entities: reverse ? [...zero.entities].reverse() : zero.entities,
          },
        }),
      );
      const spline = splineOf(zero);
      const start = spline.pointOccurrences[0]!;
      expect(f.session.liveRegions.regions).toEqual([]);
      const warnings = f.session.liveRegions.diagnostics.filter(
        (diagnostic) => diagnostic.code === "region-join-uncertain",
      );
      expect(warnings.length).toBeGreaterThan(0);
      for (const warning of warnings) {
        expect(warning).toMatchObject({
          joinCause: {
            code: "join-zero-end-tangent",
            culprit: {
              kind: "splineTangentHandle",
              entityId: spline.entityId,
              occurrenceId: start.occurrenceId,
              pointId: start.pointId,
            },
          },
        });
      }
      expect(f.session.validationMessage).toContain(
        "Affects ‘Spline 3’ start handle.",
      );
      expect(f.session.validationMessage).toContain(
        reverse
          ? "query of ‘Spline 3’ span 1 and ‘3-point arc 2’"
          : "query of ‘3-point arc 2’ and ‘Spline 3’ span 1",
      );
      expect(f.session.validationMessage).toContain(
        "drag the handle out of zero, or Reset to automatic",
      );
      const snapshot = {
        ...f.session.liveSolve!.solvedSnapshot,
        diagnostics: warnings,
      };
      expect(
        validateSolvedSketchSnapshot(JSON.parse(JSON.stringify(snapshot)))
          .success,
      ).toBe(true);
      expect(
        validateSolvedSketchSnapshot({
          ...snapshot,
          diagnostics: [{
            ...warnings[0],
            joinCause: {
              code: "join-zero-end-tangent",
              culprit: {
                kind: "splineTangentHandle",
                entityId: spline.entityId,
                occurrenceId: 42,
                pointId: start.pointId,
              },
            },
          }],
        }).success,
      ).toBe(false);
    },
  );

  test.each([
    "changed Stroke",
    "repeated Stroke",
    "unchanged sketch label",
    "changed sketch label",
    "unchanged item label",
  ] as const)(
    "%s keeps the exact withheld status without a replacement region result",
    async (operation) => {
      const drawn = drawnMixedOutlineSession();
      const f = await createSketchActionOwnerFixture(
        rebuildSessionForDefinition(drawn, {
          definition: withZeroStartTangent(drawn.definition),
        }),
      );
      const regions = f.session.liveRegions;
      const diagnostics = regions.diagnostics;
      expect(regions.status).toBe("current");
      expect(regions.regions).toEqual([]);
      expect(f.session.validationMessage).toBe(ZERO_JOIN_TEXT);
      const entity = f.session.definition.entities[0]!;
      const stroke = () =>
        f.dispatch({
          type: "sketch.styleAuthored",
          targets: [entity.target],
          patch: { field: "strokeWidth", value: 3 },
        });
      if (operation === "repeated Stroke") stroke();
      const definition = f.session.definition;
      const labels = f.undoLabels();
      if (operation.endsWith("Stroke")) {
        stroke();
        expect(f.session.definition.entities[0]!.style?.strokeWidth).toBe(3);
        expect(f.session.liveSolve?.sourceDefinition).toBe(
          f.session.definition,
        );
      } else {
        f.dispatch({
          type: "sketch.labelSet",
          target:
            operation === "unchanged item label"
              ? entity.target
              : {
                  kind: "sketch",
                  sketchId: entity.target.sketchId,
                },
          label:
            operation === "unchanged item label"
              ? entity.label
              : operation === "changed sketch label"
                ? "Withheld outline"
                : f.session.sketchLabel,
        });
      }
      expect(f.session.validationMessage).toBe(ZERO_JOIN_TEXT);
      expect(f.state.pendingRegionRequest).toBeNull();
      await f.settle();
      expect(f.session.liveRegions).toBe(regions);
      expect(f.session.liveRegions.diagnostics).toBe(diagnostics);
      expect(f.session.validationMessage).toBe(ZERO_JOIN_TEXT);
      if (
        operation.startsWith("unchanged") ||
        operation === "repeated Stroke"
      ) {
        expect(f.session.definition).toBe(definition);
        expect(f.undoLabels()).toEqual(labels);
      } else {
        expect(f.undoLabels()).toHaveLength(labels.length + 1);
      }
    },
  );

  test("calm: the same uncertain join on an open chain (no line, so no closed outline and no region to lose) stays in the preview label, off the status line", async () => {
    const drawn = drawnMixedOutlineSession({ withLine: false });
    const f = await createSketchActionOwnerFixture(
      rebuildSessionForDefinition(drawn, {
        definition: withZeroStartTangent(drawn.definition),
      }),
    );
    expect(f.session.liveRegions.status).toBe("current");
    expect(
      f.session.liveRegions.diagnostics.map((diagnostic) => diagnostic.code),
      "premise: the join is uncertain here too",
    ).toContain("region-join-uncertain");
    expect(f.session.validationMessage, "no status line").toBeNull();
  });

  test("the owner's rule (review R-2): a lost region is explained only by a warning naming a curve that bounded it, and the text is that warning's", async () => {
    const drawn = drawnMixedOutlineSession({ withLine: false });
    const f = await createSketchActionOwnerFixture(
      rebuildSessionForDefinition(drawn, {
        definition: withZeroStartTangent(drawn.definition),
      }),
    );
    expect(f.session.liveRegions.regions, "premise").toEqual([]);
    const [arc, spline] = f.session.definition.entities;
    const warnings = f.session.liveRegions.diagnostics.filter(
      (diagnostic) => diagnostic.code === "region-join-uncertain",
    );
    const about = (entityId: string) =>
      warnings.find(
        (diagnostic) =>
          diagnostic.target?.kind === "entity" &&
          diagnostic.target.entityId === entityId,
      )!.message;
    expect(
      about(arc!.entityId),
      "both affected branches identify the same actual spline-handle culprit",
    ).toBe(about(spline!.entityId));
    const lostRegionBoundedBy = (entityId: string) =>
      ({
        regionId: "region_lost",
        loops: [
          {
            segments: [
              {
                branch: {
                  source: { kind: "entity", entityId },
                  spanId: "whole",
                },
              },
            ],
          },
        ],
      }) as never;
    const RECOVERY = " No region is formed there. Undo, drag the handle out of zero, or Reset to automatic.";
    expect(
      describeSketchSessionWithheldRegions(f.session, [
        lostRegionBoundedBy(arc!.entityId),
      ]),
      "a region bounded by the arc is gone: the arc's warning",
    ).toBe(`${about(arc!.entityId)}${RECOVERY}`);
    expect(
      describeSketchSessionWithheldRegions(f.session, [
        lostRegionBoundedBy(spline!.entityId),
      ]),
      "a region bounded by the spline only: the spline's warning, not the first one",
    ).toBe(`${about(spline!.entityId)}${RECOVERY}`);
    expect(
      describeSketchSessionWithheldRegions(f.session, [
        lostRegionBoundedBy("sketch_entity_elsewhere"),
      ]),
      "a lost region bounded by other curves is not explained by these warnings",
    ).toBeNull();
    expect(describeSketchSessionWithheldRegions(f.session, [])).toBeNull();
  });

  test("a distinct certified uncertainty keeps generic recovery, even with zero-handle prose or stale culprit metadata", async () => {
    const query = createCertifiedNeutralCurveQuery();
    const line = (id: string, x: number) => ({
      kind: "line" as const,
      form: "endpointSegment" as const,
      curveId: id,
      provenance: { sourceEntityId: id, sourceSpanId: "whole" },
      start: [x, 0] as const,
      end: [x + 1, 0] as const,
      sourceDomain: [0, 1] as const,
    });
    const failure = query.queryJoin({
      first: line("before", 0),
      second: line("after", 2),
      joins: [{ first: "end", second: "start" }],
      modelingTolerance: 0.001,
    });
    expect(failure).toMatchObject({
      kind: "uncertain",
      code: "join-ball-exceeds-tolerance",
    });
    if (failure.kind === "verified") throw new Error("Expected a failed join.");
    const drawn = drawnMixedOutlineSession();
    const f = await createSketchActionOwnerFixture(
      rebuildSessionForDefinition(drawn, {
        definition: withZeroStartTangent(drawn.definition),
      }),
    );
    const diagnostics = f.session.liveRegions.diagnostics.map((warning) => ({
      ...warning,
      joinCause: { ...warning.joinCause, code: failure.code },
    }));
    const published = publishSketchLiveRegions(f.session, [], diagnostics);
    expect(published.validationMessage).toBe(
      `${diagnostics[0]!.message} No region is formed there. Undo, or edit that geometry.`,
    );
    expect(published.validationMessage).not.toContain("Reset to automatic");
    // Without an owner-provided culprit, even the zero-tangent code must not guess.
    const unlocated = diagnostics.map((warning) => ({
      ...warning,
      joinCause: { code: "join-zero-end-tangent" },
    }));
    expect(
      publishSketchLiveRegions(published, [], unlocated).validationMessage,
    ).not.toContain("Reset to automatic");
  });

  test("review R-2: a rectangle beside that silent open-chain warning; deleting a rectangle edge (the user's own removal) shows no withheld-region text", async () => {
    const drawn = drawnMixedOutlineSession({ withLine: false });
    const zeroed = rebuildSessionForDefinition(drawn, {
      definition: withZeroStartTangent(drawn.definition),
    });
    const withRectangle = clearActiveSketchTool(
      acceptSketchDraw(
        startSketchDraw(beginSketchTool(zeroed, "rectangle"), [10, 0]),
        [12, 2],
      ),
    );
    const f = await createSketchActionOwnerFixture(
      rebuildSessionForDefinition(withRectangle, {
        definition: withRectangle.definition,
      }),
    );
    expect(
      f.session.liveRegions.regions,
      "premise: the rectangle",
    ).toHaveLength(1);
    expect(
      f.session.liveRegions.diagnostics.map((diagnostic) => diagnostic.code),
      "premise: the open chain's uncertain join",
    ).toContain("region-join-uncertain");
    expect(f.session.validationMessage, "premise: silent").toBeNull();
    const edge = f.session.definition.entities
      .filter((entity) => entity.kind === "lineSegment")
      .at(-1)!;
    f.dispatch({ type: "viewport.selectionRequested", target: edge.target });
    f.dispatch({ type: "sketch.annotationDeleteRequested" });
    await f.settle();
    expect(f.undoLabels()).toEqual(["Delete Sketch Item"]);
    expect(f.session.liveRegions.regions, "the region is gone").toEqual([]);
    expect(
      f.session.validationMessage,
      "no unrelated explanation on the status line",
    ).toBeNull();
  });

  test("review A-4: a later region result that withholds nothing clears the explanation this owner set, and never another owner's message", async () => {
    const drawn = drawnMixedOutlineSession();
    const f = await createSketchActionOwnerFixture(
      rebuildSessionForDefinition(drawn, {
        definition: withZeroStartTangent(drawn.definition),
      }),
    );
    expect(f.session.validationMessage, "premise").toBe(ZERO_JOIN_TEXT);
    const pending = {
      ...f.session,
      liveRegions: { ...f.session.liveRegions, status: "pending" as const },
    };
    expect(
      publishSketchLiveRegions(pending, [], []).validationMessage,
      "its own explanation is cleared",
    ).toBeNull();
    expect(
      publishSketchLiveRegions(
        { ...pending, validationMessage: "Another owner's message." },
        [],
        [],
      ).validationMessage,
      "another owner's message is kept",
    ).toBe("Another owner's message.");
  });

  test("review A-3: with the Line tool armed, drawing elsewhere keeps the explanation steady across pointer moves and the next clicks", async () => {
    const drawn = drawnMixedOutlineSession();
    const f = await createSketchActionOwnerFixture(
      rebuildSessionForDefinition(drawn, {
        definition: withZeroStartTangent(drawn.definition),
      }),
    );
    f.dispatch({ type: "tool.activated", toolId: "line" });
    const release = (point: readonly [number, number]) =>
      f.dispatch({
        type: "sketch.pointerReleased",
        point,
        sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      });
    const move = (point: readonly [number, number]) =>
      f.dispatch({
        type: "sketch.pointerMoved",
        point,
        sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      });
    move([20, 20]);
    release([20, 20]);
    move([22, 20]);
    release([22, 20]);
    await f.settle();
    expect(f.undoLabels(), "premise: a line drawn").toEqual([
      "Create Sketch Geometry",
    ]);
    expect(f.session.validationMessage, "shown after the commit").toBe(
      ZERO_JOIN_TEXT,
    );
    move([25, 25]);
    expect(f.session.validationMessage, "a hover keeps it").toBe(
      ZERO_JOIN_TEXT,
    );
    release([25, 25]);
    move([27, 25]);
    expect(
      f.session.validationMessage,
      "rubber-banding the next line keeps it",
    ).toBe(ZERO_JOIN_TEXT);
    expect(
      f.session.toolPresentation?.validation ?? [],
      "it is not shown as the tool's own validation",
    ).toEqual([]);
  });
});

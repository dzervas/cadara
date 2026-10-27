import type {
  ConstraintId,
  SketchEntityId,
  SketchId,
} from "@/contracts/shared/ids";
import type { SketchConstraintRef } from "@/contracts/shared/references";
import type { ConstraintDefinition } from "@/contracts/sketch/schema";
import {
  getDefaultSelectionFilterForMode,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createReferenceImageOperation } from "@/core/reference-image/operations";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  initialEditorState,
  type SketchEditorState,
} from "@/core/editor/state-machine";

/**
 * T14c shared seam fixture (logic lane): an idle sketch with line G, line H
 * and a far line K, and four constraints:
 * - A: Horizontal on G, B: Fix on G's start point (A's sibling: both pin
 *   when G is selected, B through G's defining points, T-4);
 * - C: Parallel on G and H (in the context of G and of H);
 * - D: Horizontal on K (unrelated to G and H).
 * The sketch also carries a reference image (a `sketchOperation` target,
 * the pick class below `region`) for special-mode and blank-class rows.
 */
export async function makeAnnotationLifecycleState() {
  const sketchId = "sketch_draft" as SketchId;
  let session = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  for (const [start, end] of [
    [
      [0, 0],
      [10, 0],
    ],
    [
      [0, 5],
      [10, 5],
    ],
    [
      [20, 20],
      [30, 20],
    ],
  ] as const) {
    session = acceptSketchDraw(
      startSketchDraw(beginSketchTool(session, "line"), [...start]),
      [...end],
    );
  }
  const [g, h, k] = session.definition.entities;
  if (g?.kind !== "lineSegment" || !h || !k) {
    throw new Error("Expected three lines.");
  }
  const constraints: ConstraintDefinition[] = [
    {
      constraintId: "constraint_a_horizontal" as ConstraintId,
      kind: "horizontal",
      label: "Horizontal",
      entityId: g.entityId,
    },
    {
      constraintId: "constraint_b_fix" as ConstraintId,
      kind: "fixPoint",
      label: "Fix",
      pointId: g.startPointId,
      position: [0, 0],
    },
    {
      constraintId: "constraint_c_parallel" as ConstraintId,
      kind: "parallel",
      label: "Parallel",
      entityIds: [g.entityId, h.entityId],
    },
    {
      constraintId: "constraint_d_horizontal" as ConstraintId,
      kind: "horizontal",
      label: "Horizontal",
      entityId: k.entityId,
    },
  ];
  const image = createReferenceImageOperation({
    sequence: 1,
    sketchId,
    payload: {
      mediaType: "image/png",
      pixelWidth: 4,
      pixelHeight: 2,
      base64Data: "cG5n",
    },
  });
  session = {
    ...session,
    activeTool: null,
    status: "idle",
    toolChain: null,
    definition: {
      ...session.definition,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
      referenceImages: [image],
    },
  } satisfies SketchSessionState;

  const entity = (entityId: SketchEntityId): PrimitiveRef => ({
    kind: "sketchEntity",
    sketchId,
    entityId,
  });
  const constraint = (constraintId: string): SketchConstraintRef => ({
    kind: "constraint",
    sketchId,
    constraintId: constraintId as ConstraintId,
  });
  const state: SketchEditorState = {
    ...initialEditorState,
    kind: "editingSketch",
    mode: "sketch",
    selectionFilter: getDefaultSelectionFilterForMode("sketch"),
    snapshot: await createSeedDocumentSnapshot(),
    document: { documentId: "doc_workspace", revisionId: "rev_1" },
    command: {
      commandSessionId: "command_t14c",
      toolId: "sketch",
      phase: "editing",
    },
    session,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingRegionRequest: null,
  };

  return {
    state,
    g: entity(g.entityId),
    h: entity(h.entityId),
    k: entity(k.entityId),
    gStart: {
      kind: "sketchPoint",
      sketchId,
      pointId: g.startPointId,
    } as PrimitiveRef,
    a: constraint("constraint_a_horizontal"),
    b: constraint("constraint_b_fix"),
    c: constraint("constraint_c_parallel"),
    d: constraint("constraint_d_horizontal"),
    image: {
      kind: "sketchOperation",
      sketchId,
      operationId: image.operationId,
    } as PrimitiveRef,
  };
}

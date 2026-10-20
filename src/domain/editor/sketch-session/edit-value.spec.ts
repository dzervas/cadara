import { expect, test } from "vitest";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import { offsetSession } from "@/domain/editor/sketch-offset.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  beginSketchTool,
  createSketchSessionFromSnapshot,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
  updateSketchEditToolHover,
  refreshSketchEditToolAfterOffsetRound,
  publishSketchLiveRegions,
} from "@/domain/editor/sketch-session";

// Logic lane: session patches must preserve the last valid preview/anchor
// while an operation parameter is incomplete, including a refused Enter.
test.each(["offset", "sketchFillet", "sketchChamfer"] as const)(
  "O29: %s keeps its preview and input through zero, refuses Enter, then recovers",
  (toolId) => {
    const f = makeSketchFixture();
    f.point("a", 0, 0);
    f.point("b", 10, 0);
    f.point("c", 10, 10);
    f.line("ab", "a", "b");
    f.line("bc", "b", "c");
    let selected = beginSketchTool(
      createSketchSessionFromSnapshot(
        sketchSnapshotRecordForTest(
          f.build(),
          [],
          createStandardPlaneDefinition("xy"),
        ),
        OCC_KERNEL_SETTINGS,
      ),
      toolId,
    );
    for (const entity of selected.definition.entities.slice(
      0,
      toolId === "offset" ? 1 : 2,
    ))
      selected = selectSketchEditToolTarget(selected, entity.target);
    const valid = patchSketchEditToolValue(selected, { value: "1" });
    expect(valid.validationMessage).toBeNull();
    expect(valid.toolPresentation?.validation).toEqual([]);
    expect(valid.toolStagedEntities.length).toBeGreaterThan(0);
    const anchor = valid.toolPresentation!.floatingInput!.anchor;
    expect(anchor).toBeTruthy();
    const zero = patchSketchEditToolValue(valid, { value: "0" });
    expect(zero.validationMessage, "tool errors do not enter session notifications").toBeNull();
    expect(zero.toolPresentation?.validation?.[0]?.message).toMatch(/greater than zero/);
    expect(zero.activeTool).toBe(toolId);
    expect(zero.activeEditTool!.selectedTargets).toEqual(
      valid.activeEditTool!.selectedTargets,
    );
    expect(zero.toolStagedEntities).toBe(valid.toolStagedEntities);
    expect(zero.toolPresentation!.floatingInput!.anchor).toEqual(anchor);
    // Pointer hover and a background solve can arrive between keystrokes.
    const hovered = updateSketchEditToolHover(zero, null);
    expect(hovered.toolPresentation!.floatingInput!.anchor).toEqual(anchor);
    const refreshed = refreshSketchEditToolAfterOffsetRound(hovered);
    expect(refreshed.toolPresentation!.floatingInput!.anchor).toEqual(anchor);
    expect(refreshed.toolStagedEntities).toBe(valid.toolStagedEntities);
    expect(refreshed.toolPresentation?.validation?.[0]?.message).toMatch(/greater than zero/);
    const refused = patchSketchEditToolValue(zero, {
      intent: toolId === "offset" ? "commitOffset" : "commitSketchEditOperator",
    });
    expect(refused.definition).toBe(valid.definition);
    expect(refused.toolPresentation?.validation?.[0]?.message).toMatch(/greater than zero/);
    expect(refused.toolPresentation!.floatingInput!.anchor).toEqual(anchor);
    expect(refused.toolStagedEntities).toBe(valid.toolStagedEntities);
    const recovered = patchSketchEditToolValue(refused, { value: "0.5" });
    expect(recovered.validationMessage).toBeNull();
    expect(recovered.toolPresentation!.validation).toEqual([]);
    expect(recovered.toolStagedEntities.length).toBeGreaterThan(0);
    expect(recovered.toolStagedEntities).not.toEqual(valid.toolStagedEntities);
    const nonNumeric = patchSketchEditToolValue(recovered, { value: "-" });
    expect(nonNumeric.toolPresentation?.validation?.[0]?.message).toMatch(/^Enter a number for the /);
    const refreshedNonNumeric =
      refreshSketchEditToolAfterOffsetRound({
        ...nonNumeric,
        validationMessage: "Session profiles unavailable.",
      });
    expect(refreshedNonNumeric.validationMessage).toBe("Session profiles unavailable.");
    expect(refreshedNonNumeric.toolPresentation?.validation?.[0]?.message).toBe(
      nonNumeric.toolPresentation?.validation?.[0]?.message,
    );
    expect(refreshedNonNumeric.toolStagedEntities).toBe(
      recovered.toolStagedEntities,
    );
    expect(refreshedNonNumeric.toolPresentation!.floatingInput!.anchor).toEqual(
      recovered.toolPresentation!.floatingInput!.anchor,
    );
  },
);

test.each(["offset", "sketchSlot"] as const)(
  "O29: %s replaces an earlier pending message with the failed round gate for a valid value",
  (toolId) => {
    const { session, relationship } = offsetSession("singleLine");
    const output = session.definition.entities.find(
      (entity) => entity.entityId === relationship.outputs[0]!.outputEntityId,
    )!;
    const selected = patchSketchEditToolValue(
      selectSketchEditToolTarget(
        beginSketchTool(session, toolId),
        output.target,
      ),
      { value: "0.2" },
    );
    expect(selected.toolPresentation?.validation?.[0]?.message).toContain("still being checked");
    const failed = publishSketchLiveRegions(
      selected,
      [],
      [],
      [
        {
          derivationId: relationship.derivationId,
          status: "failed",
          diagnostic: {
            code: OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
            severity: "error",
            message: "round failed",
            target: null,
          },
        },
      ],
    );
    const refreshed = refreshSketchEditToolAfterOffsetRound(failed);
    expect(refreshed.toolPresentation?.validation?.[0]?.message).toContain("which is not certified");
    expect(refreshed.toolPresentation?.validation?.[0]?.message).not.toContain("still being checked");
    expect(refreshed.validationMessage, "the failed tool gate is not a session message").not.toBe(
      refreshed.toolPresentation?.validation?.[0]?.message,
    );
    expect(refreshed.definition).toBe(selected.definition);
    expect(refreshed.activeEditTool!.offsetPublication).toBeUndefined();
  },
);

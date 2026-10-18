import { expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

const CONFLICTING_REQUIREMENTS = [
  {
    constraintId: "constraint_conflicting_a",
    kind: "fixPoint",
    label: "Conflicting point requirement A",
    position: [0, 0],
  },
  {
    constraintId: "constraint_conflicting_b",
    kind: "fixPoint",
    label: "Conflicting point requirement B",
    position: [100, 0],
  },
] as const;

/** The reopened sketch keeps both requirements, names them in diagnostics, and blocks profiles. */
function expectRetainedConflict(opened: SemanticResult, sketchId: string) {
  expect(opened.discovery!.state.editingContext).toEqual({
    kind: "sketch",
    sketchId,
  });
  expect(opened.completion.geometry.kind).toBe("invalid-editable");
  const sketch = opened.discovery!.sketch!;
  expect(sketch.validity.state).toBe("invalid");
  expect(sketch.profiles).toEqual([]);
  expect(sketch.constraints.filter((c) => c.kind === "fixPoint")).toEqual(
    CONFLICTING_REQUIREMENTS.map(({ constraintId, label }) => ({
      constraintId,
      kind: "fixPoint",
      label,
      status: "unsatisfied",
    })),
  );
  expect(sketch.validity.diagnostics).toEqual(
    expect.arrayContaining([
      ...CONFLICTING_REQUIREMENTS.map(({ constraintId, label }) =>
        expect.objectContaining({
          code: "solver-requirement-unsatisfied",
          message: `${label} is not satisfied within its authored tolerance.`,
          target: { kind: "constraint", constraintId },
        }),
      ),
      expect.objectContaining({
        code: "regions-unavailable",
        message:
          "Sketch profiles are unavailable until every sketch constraint is solved.",
      }),
    ]),
  );
}

// Migrated from e2e/sketch-invalid-persistence.spec.ts: the browser Finish,
// Save As/Open and re-entry are the semantic sketch.publish, document.save/open
// and sketch.open over the same native file.
it("nonconverged authored sketch finishes, saves, reopens and re-enters with diagnostics intact", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-invalid-"));
  const f = await createSketchWorkflow();
  try {
    const authored = await f.author({
      kind: "rectangle",
      start: [0, 0],
      end: [20, 10],
    });
    const valid = await f.execute({
      operation: "sketch.publish",
      draft: authored.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketchId = valid.discovery!.sketch!.sketchId!;
    expect(valid.discovery!.sketch!.profiles).toHaveLength(1);

    // Author the conflict straight into the current native format, as the
    // browser row did, so the sketch is invalid only through file contents.
    const native = await f.saveAndRead();
    const definition = native.sketches[0]!.definition;
    const pointId = definition.pointIds[0]!;
    const conflicting = CONFLICTING_REQUIREMENTS.map((requirement) => ({
      ...requirement,
      position: [...requirement.position] as [number, number],
      pointId,
    }));
    definition.constraintIds.push(...conflicting.map((c) => c.constraintId));
    definition.constraints.push(...conflicting);
    const invalidPath = resolve(directory, "invalid-current.cadara");
    await writeFile(invalidPath, JSON.stringify(native));

    await f.execute({
      operation: "document.open",
      basis: null,
      path: invalidPath,
    });
    const reentered = await f.run({ operation: "sketch.open", sketchId });
    expect(reentered.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(reentered.completion.live.kind).toBe("applied");
    expectRetainedConflict(reentered, sketchId);

    const inspected = await f.execute({
      operation: "sketch.inspect",
      draft: reentered.discovery!.state.draft,
    });
    expect(inspected.outcome).toEqual({
      kind: "completed",
      change: "unchanged",
    });
    expect(inspected.completion.live.kind).toBe("unchanged");
    expectRetainedConflict(inspected, sketchId);

    // Finish: the invalid sketch leaves sketch mode and is committed, but no
    // geometry or profiles are certified from it.
    const finished = await f.run({
      operation: "sketch.publish",
      draft: inspected.discovery!.state.draft,
      requireProfiles: false,
    });
    expect(finished.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(finished.completion.live.kind).toBe("applied");
    expect(finished.discovery!.state.editingContext).toEqual({
      kind: "document",
    });
    expect(finished.completion.persistence.kind).toBe("committed");
    expect(finished.completion.geometry.kind).toBe("failed");
    expect(finished.discovery!.sketch!.validity.state).toBe("invalid");
    expect(finished.discovery!.sketch!.profiles).toEqual([]);

    const reopenedPath = resolve(directory, "invalid-reopened.cadara");
    const saved = await f.execute({
      operation: "document.save",
      path: reopenedPath,
    });
    expect(saved.completion.file.kind).toBe("written");
    const savedInvalid: AuthoredModelDocument = JSON.parse(
      await readFile(reopenedPath, "utf8"),
    );
    expect(savedInvalid.sketches[0]!.definition.constraintIds).toEqual(
      expect.arrayContaining(conflicting.map((c) => c.constraintId)),
    );
    expect(savedInvalid.sketches[0]!.definition.constraints).toEqual(
      expect.arrayContaining(conflicting),
    );

    await f.execute({
      operation: "document.open",
      basis: null,
      path: reopenedPath,
    });
    const reopened = await f.run({ operation: "sketch.open", sketchId });
    expect(reopened.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(reopened.completion.live.kind).toBe("applied");
    expectRetainedConflict(reopened, sketchId);
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

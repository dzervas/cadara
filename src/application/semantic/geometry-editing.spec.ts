import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createArcEndpointDimensions } from "@/core/sketch-tools/constraints";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type {
  SketchId,
  SketchPointId,
  SketchEntityId,
} from "@/contracts/shared/ids";
import { createPlateWorkflow } from "../../../test/helpers/semantic-workflow";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";

describe("semantic sketch geometry editing", () => {
  it("opens native authored curves, edits circle and arc radii and a spline tangent, and publishes a measured native cylinder", async () => {
    const f = await createPlateWorkflow();
    const directory = await mkdtemp(resolve(tmpdir(), "cadara-curve-edit-"));
    try {
      const path = resolve(directory, "curves.cadara");
      await f.execute({ operation: "document.save", path });
      // This is a native input-file fixture, not a runtime/session mutation.
      // All edits, history, publication and native geometry go through commands.
      const document: AuthoredModelDocument = JSON.parse(
        await readFile(path, "utf8"),
      );
      const sketchId = "sketch_curve_fixture" as SketchId;
      const point = (name: string, position: readonly [number, number]) => {
        const pointId = `sketch_point_curve_${name}` as SketchPointId;
        return {
          pointId,
          label: name,
          position,
          isConstruction: false,
          target: { kind: "sketchPoint" as const, sketchId, pointId },
        };
      };
      const points = [
        point("center", [40, 40]),
        point("arc-center", [70, 0]),
        point("arc-start", [73, 0]),
        point("arc-end", [70, 3]),
        point("fit-a", [80, 0]),
        point("fit-b", [85, 5]),
        point("fit-c", [90, 0]),
      ];
      const entity = (name: string, isConstruction: boolean) => {
        const entityId = `sketch_entity_curve_${name}` as SketchEntityId;
        return {
          entityId,
          label: name,
          isConstruction,
          target: { kind: "sketchEntity" as const, sketchId, entityId },
        };
      };
      const entities: SketchDefinition["entities"] = [
        {
          ...entity("circle", false),
          kind: "circle",
          centerPointId: points[0]!.pointId,
          radius: 3,
        },
        {
          ...entity("arc", true),
          kind: "arc",
          centerPointId: points[1]!.pointId,
          startPointId: points[2]!.pointId,
          endPointId: points[3]!.pointId,
          sweepDirection: "counterClockwise",
        },
        {
          ...entity("spline", true),
          kind: "spline",
          pointOccurrenceIds: ["a", "b", "c"],
          pointOccurrences: points.slice(4).map((p, i) => ({
            occurrenceId: ["a", "b", "c"][i]!,
            pointId: p.pointId,
            tangent: { kind: "automatic" as const },
          })),
          closure: "open",
          interpolationPolicy: "centripetal-mean-arm-v1",
        },
      ];
      const dimensions = createArcEndpointDimensions({
        createDimensionId: (suffix) => `dimension_curve_${suffix}`,
        labelPrefix: "Arc",
        entityId: entities[1]!.entityId,
        startPointId: points[2]!.pointId,
        endPointId: points[3]!.pointId,
      });
      document.sketches.push({
        sketchId,
        label: "Curves",
        plane: document.sketches[0]!.plane,
        definition: {
          schemaVersion: document.sketches[0]!.definition.schemaVersion,
          referenceIds: [],
          references: [],
          pointIds: points.map((p) => p.pointId),
          points,
          entityIds: entities.map((e) => e.entityId),
          entities,
          constraintIds: [],
          constraints: [],
          dimensionIds: dimensions.map((d) => d.dimensionId),
          dimensions,
        },
      });
      document.historyOrder.push({ kind: "sketch", sketchId });
      document.cursor = { kind: "sketch", sketchId };
      const curveDefinition = document.sketches.at(-1)!.definition;
      curveDefinition.dimensionIds = [];
      curveDefinition.dimensions = [];
      await writeFile(path, JSON.stringify(document));
      await f.execute({ operation: "document.open", path, basis: null });
      const unbound = await f.execute({ operation: "sketch.open", sketchId });
      const refused = await f.run({
        operation: "sketch.geometry.update",
        draft: unbound.discovery!.state.draft,
        edit: { kind: "radius", target: entities[1]!.target, radius: 5 },
        intent: "fulfill",
      });
      expect(refused.outcome).toEqual({
        kind: "rejected",
        reasonCode: "sketch-edit-refused",
      });
      expect(refused.completion.live.kind).toBe("unchanged");
      expect(
        refused.diagnostics.some((d) =>
          d.message.includes("endpoint bindings"),
        ),
      ).toBe(true);
      await f.execute({
        operation: "sketch.discard",
        draft: refused.completion.live.state!.draft,
      });
      curveDefinition.dimensionIds = dimensions.map((d) => d.dimensionId);
      curveDefinition.dimensions = dimensions;
      await writeFile(path, JSON.stringify(document));
      await f.execute({ operation: "document.open", path, basis: null });
      const opened = await f.execute({ operation: "sketch.open", sketchId });
      const circle = opened.discovery!.sketch!.entities.find(
        (e) => e.kind === "circle",
      )!;
      const arc = opened.discovery!.sketch!.entities.find(
        (e) => e.kind === "arc",
      )!;
      const spline = opened.discovery!.sketch!.entities.find(
        (e) => e.kind === "spline",
      )!;
      expect(circle.radius).toBe(3);
      const circleTarget = {
        kind: "sketchEntity",
        sketchId,
        entityId: circle.entityId,
      };
      const sized = await f.execute({
        operation: "sketch.geometry.update",
        draft: opened.discovery!.state.draft,
        edit: { kind: "radius", target: circleTarget, radius: 6 },
        intent: "fulfill",
      });
      expect(
        sized.discovery!.sketch!.entities.find(
          (e) => e.entityId === circle.entityId,
        )?.radius,
      ).toBeCloseTo(6, 6);
      await f.execute({
        operation: "sketch.geometry.update",
        draft: sized.discovery!.state.draft,
        edit: { kind: "translate", target: circleTarget, delta: [10, -5] },
        intent: "fulfill",
      });
      const arcSized = await f.execute({
        operation: "sketch.geometry.update",
        draft: f.current().discovery!.state.draft,
        edit: {
          kind: "radius",
          target: { kind: "sketchEntity", sketchId, entityId: arc.entityId },
          radius: 5,
        },
        intent: "fulfill",
      });
      expect(
        Math.abs(
          arcSized.discovery!.sketch!.entities.find(
            (e) => e.entityId === arc.entityId,
          )!.radius! - 5,
        ),
      ).toBeLessThan(document.settings.modelingTolerance);
      const tangent = spline.tangents![0]!;
      const shaped = await f.execute({
        operation: "sketch.geometry.update",
        draft: arcSized.discovery!.state.draft,
        edit: {
          kind: "tangent",
          target: {
            kind: "sketchTangentHandle",
            sketchId,
            entityId: spline.entityId,
            occurrenceId: tangent.occurrenceId,
            pointId: tangent.pointId,
          },
          vector: [2, 3],
        },
        intent: "fulfill",
      });
      const vector = shaped.discovery!.sketch!.entities.find(
        (e) => e.entityId === spline.entityId,
      )!.tangents![0]!.vector!;
      expect(vector[0]).toBeCloseTo(2, 6);
      expect(vector[1]).toBeCloseTo(3, 6);
      const published = await f.execute({
        operation: "sketch.publish",
        draft: shaped.discovery!.state.draft,
        requireProfiles: true,
      });
      expect(
        published.discovery!.sketch!.entities.map((e) => e.entityId),
      ).toEqual(opened.discovery!.sketch!.entities.map((e) => e.entityId));
      const solid = await f.execute({
        operation: "extrude.create",
        profile: {
          kind: "region",
          sketchId,
          regionId: published.discovery!.sketch!.profiles[0]!.regionId,
        },
        depth: 4,
        intent: "fulfill",
      });
      const body = solid.discovery!.model!.bodies.find(
        (b) =>
          !f.solid.discovery!.model!.bodies.some(
            (old) => old.bodyId === b.bodyId,
          ),
      )!;
      for (const [index, value] of [44, 29, 0].entries())
        expect(body.bounds!.min[index]).toBeCloseTo(value, 6);
      for (const [index, value] of [56, 41, 4].entries())
        expect(body.bounds!.max[index]).toBeCloseTo(value, 6);
    } finally {
      await f.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);
  it("retains explicitly invalid authoring while labeling, repairs dependent requirements by deletion, and discards the whole draft", async () => {
    const f = await createPlateWorkflow();
    try {
      const sketchId = f.published.discovery!.sketch!.sketchId!;
      const opened = await f.execute({ operation: "sketch.open", sketchId });
      const points = opened.discovery!.sketch!.points;
      const invalid = await f.run({
        operation: "sketch.dimension.add",
        draft: opened.discovery!.state.draft,
        axis: "horizontal",
        points: [points[0]!.pointId, points[1]!.pointId],
        mode: "driving",
        value: 25,
        intent: "author-invalid",
      });
      expect(invalid.outcome.kind).toBe("accepted-invalid");
      expect(invalid.discovery!.sketch!.profiles).toEqual([]);
      expect(
        invalid.discovery!.references.some(
          (r) => r.target.kind === "region" && r.target.sketchId === sketchId,
        ),
      ).toBe(false);
      const dimensionId =
        invalid.discovery!.sketch!.requirements.at(-1)!.dimensionId;
      const labeled = await f.run({
        operation: "sketch.label.set",
        draft: invalid.discovery!.state.draft,
        target: { kind: "dimension", sketchId, dimensionId },
        label: "Conflicting width",
        intent: "author-invalid",
      });
      expect(labeled.outcome.kind).toBe("accepted-invalid");
      expect(labeled.discovery!.sketch!.requirements.at(-1)!.label).toBe(
        "Conflicting width",
      );
      expect(validateSemanticResult(labeled.correlation, labeled).success).toBe(
        true,
      );
      const refused = await f.run({
        operation: "sketch.publish",
        draft: labeled.discovery!.state.draft,
        requireProfiles: true,
      });
      expect(refused.outcome).toEqual({
        kind: "rejected",
        reasonCode: "profiles-unusable",
      });
      const repaired = await f.execute({
        operation: "sketch.geometry.delete",
        draft: refused.completion.live.state!.draft,
        targets: [
          { kind: "sketchPoint", sketchId, pointId: points[1]!.pointId },
        ],
        intent: "fulfill",
      });
      expect(repaired.discovery!.sketch!.requirements).toEqual([]);
      expect(repaired.discovery!.sketch!.profiles).toEqual([]);
      expect(repaired.completion.geometry.kind).toBe("current");
      const renamed = await f.execute({
        operation: "sketch.label.set",
        draft: repaired.discovery!.state.draft,
        target: { kind: "sketch", sketchId },
        label: "Private renamed sketch",
        intent: "fulfill",
      });
      expect(
        renamed.discovery!.references.find(
          (r) => r.target.kind === "sketch" && r.target.sketchId === sketchId,
        )?.label,
      ).toBe("Private renamed sketch");
      const discarded = await f.execute({
        operation: "sketch.discard",
        draft: renamed.discovery!.state.draft,
      });
      expect(discarded.discovery!.model!.bodies[0]!.bounds).toEqual(
        f.solid.discovery!.model!.bodies[0]!.bounds,
      );
      const original = await f.execute({ operation: "sketch.open", sketchId });
      expect(original.discovery!.sketch!.requirements).toEqual(
        f.published.discovery!.sketch!.requirements,
      );
      expect(original.discovery!.sketch!.profiles).toHaveLength(1);
      expect(
        original.discovery!.references.some(
          (r) => r.label === "Private renamed sketch",
        ),
      ).toBe(false);
    } finally {
      await f.close();
    }
  }, 90_000);
  it("edits and labels an authored point, deletes its dependent requirement as one action, undoes and republishes stable identities", async () => {
    const f = await createPlateWorkflow();
    try {
      const sketchId = f.published.discovery!.sketch!.sketchId!;
      await f.execute({ operation: "sketch.open", sketchId });
      const line = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: "line", start: [50, 20], end: [60, 20] },
        construction: true,
        intent: "fulfill",
      });
      const pointId = line.discovery!.sketch!.points.at(-1)!.pointId;
      const target = { kind: "sketchPoint", sketchId, pointId };
      const edited = await f.execute({
        operation: "sketch.geometry.update",
        draft: line.discovery!.state.draft,
        edit: { kind: "point", target, position: [65, 25] },
        intent: "fulfill",
      });
      expect(
        edited.discovery!.sketch!.points.find((p) => p.pointId === pointId)
          ?.position,
      ).toEqual([65, 25]);
      expect(edited.discovery!.history!.undoEntries?.at(-1)?.label).toBe(
        "Move Sketch Geometry",
      );
      const labeled = await f.execute({
        operation: "sketch.label.set",
        draft: edited.discovery!.state.draft,
        target,
        label: "Gauge endpoint",
        intent: "fulfill",
      });
      expect(
        labeled.discovery!.references.find(
          (r) =>
            r.target.kind === "sketchPoint" && r.target.pointId === pointId,
        )?.label,
      ).toBe("Gauge endpoint");
      expect(labeled.discovery!.history!.undoEntries?.at(-1)?.label).toBe(
        "Label Sketch Item",
      );
      const unlabeled = await f.execute({
        operation: "history.undo",
        draft: labeled.discovery!.state.draft,
      });
      expect(
        unlabeled.discovery!.references.find(
          (r) =>
            r.target.kind === "sketchPoint" && r.target.pointId === pointId,
        )?.label,
      ).toBe(
        line.discovery!.references.find(
          (r) =>
            r.target.kind === "sketchPoint" && r.target.pointId === pointId,
        )!.label,
      );
      expect(
        unlabeled.discovery!.sketch!.points.find((p) => p.pointId === pointId)!
          .position,
      ).toEqual([65, 25]);
      await f.execute({
        operation: "history.redo",
        draft: unlabeled.discovery!.state.draft,
      });
      const entityTarget = {
        kind: "sketchEntity",
        sketchId,
        entityId: line.discovery!.sketch!.entities.at(-1)!.entityId,
      };
      await f.execute({
        operation: "sketch.label.set",
        draft: f.current().discovery!.state.draft,
        target: entityTarget,
        label: "Gauge line",
        intent: "fulfill",
      });
      const constraintTarget = f
        .current()
        .discovery!.references.find(
          (r) => r.target.kind === "constraint",
        )!.target;
      await f.execute({
        operation: "sketch.label.set",
        draft: f.current().discovery!.state.draft,
        target: constraintTarget,
        label: "Plate alignment",
        intent: "fulfill",
      });
      const dimensioned = await f.execute({
        operation: "sketch.dimension.add",
        draft: f.current().discovery!.state.draft,
        axis: "horizontal",
        points: [line.discovery!.sketch!.points.at(-2)!.pointId, pointId],
        mode: "reference",
        intent: "fulfill",
      });
      const dimensionId =
        dimensioned.discovery!.sketch!.measurements[0]!.dimensionId;
      const deleted = await f.execute({
        operation: "sketch.geometry.delete",
        draft: dimensioned.discovery!.state.draft,
        targets: [target],
        intent: "fulfill",
      });
      expect(
        deleted.discovery!.sketch!.points.some((p) => p.pointId === pointId),
      ).toBe(false);
      expect(deleted.discovery!.sketch!.measurements).toEqual([]);
      expect(deleted.discovery!.sketch!.requirements).toEqual(
        f.published.discovery!.sketch!.requirements,
      );
      expect(deleted.discovery!.history!.undoEntries?.at(-1)?.label).toBe(
        "Delete Sketch Geometry",
      );
      const restored = await f.execute({
        operation: "history.undo",
        draft: deleted.discovery!.state.draft,
      });
      expect(restored.discovery!.sketch!.measurements[0]!.dimensionId).toBe(
        dimensionId,
      );
      expect(
        restored.discovery!.sketch!.points.find((p) => p.pointId === pointId)
          ?.position,
      ).toEqual([65, 25]);
      const published = await f.execute({
        operation: "sketch.publish",
        draft: restored.discovery!.state.draft,
        requireProfiles: true,
      });
      expect(published.discovery!.sketch!.sketchId).toBe(sketchId);
      expect(published.discovery!.model!.bodies[0]!.bounds).toEqual(
        f.solid.discovery!.model!.bodies[0]!.bounds,
      );
      const reopened = await f.execute({ operation: "sketch.open", sketchId });
      expect(
        reopened.discovery!.references.find(
          (r) =>
            r.target.kind === "sketchPoint" && r.target.pointId === pointId,
        )?.label,
      ).toBe("Gauge endpoint");
      expect(
        reopened.discovery!.references.find(
          (r) =>
            r.target.kind === "sketchEntity" &&
            r.target.entityId === entityTarget.entityId,
        )?.label,
      ).toBe("Gauge line");
      expect(
        reopened.discovery!.references.find(
          (r) =>
            r.target.kind === "constraint" &&
            constraintTarget.kind === "constraint" &&
            r.target.constraintId === constraintTarget.constraintId,
        )?.label,
      ).toBe("Plate alignment");
    } finally {
      await f.close();
    }
  }, 90_000);
  it("refuses missing, foreign and unsupported targets without an action, and translates an entity through the existing edit solver", async () => {
    const f = await createPlateWorkflow();
    try {
      const sketchId = f.published.discovery!.sketch!.sketchId!;
      await f.execute({ operation: "sketch.open", sketchId });
      const line = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: "line", start: [50, 20], end: [60, 20] },
        construction: true,
        intent: "fulfill",
      });
      const entity = line.discovery!.sketch!.entities.at(-1)!;
      const target = {
        kind: "sketchEntity",
        sketchId,
        entityId: entity.entityId,
      };
      const shifted = await f.execute({
        operation: "sketch.geometry.update",
        draft: line.discovery!.state.draft,
        edit: { kind: "translate", target, delta: [5, 7] },
        intent: "fulfill",
      });
      for (const [index, x] of [55, 65].entries()) {
        expect(
          shifted.discovery!.sketch!.points.slice(-2)[index]!.position[0],
        ).toBeCloseTo(x, 6);
        expect(
          shifted.discovery!.sketch!.points.slice(-2)[index]!.position[1],
        ).toBeCloseTo(27, 6);
      }
      const history = shifted.discovery!.history;
      for (const input of [
        {
          operation: "sketch.geometry.update",
          edit: { kind: "radius", target, radius: 12 },
        },
        {
          operation: "sketch.geometry.delete",
          targets: [{ ...target, entityId: "sketch_entity_missing" }],
        },
        {
          operation: "sketch.geometry.delete",
          targets: [{ ...target, sketchId: "sketch_foreign" }],
        },
        { operation: "sketch.geometry.delete", targets: [] },
      ]) {
        const refused = await f.run({
          ...input,
          draft: f.current().completion.live.state!.draft,
          intent: "fulfill",
        });
        expect(refused.outcome.kind).toBe("rejected");
        expect(refused.completion.live.kind).toBe("unchanged");
        expect(
          validateSemanticResult(refused.correlation, refused).success,
        ).toBe(true);
      }
      const inspected = await f.execute({
        operation: "sketch.inspect",
        draft: f.current().completion.live.state!.draft,
      });
      expect(inspected.discovery!.history).toEqual(history);
      expect(inspected.discovery!.sketch!.points).toEqual(
        shifted.discovery!.sketch!.points,
      );
      const noChange = await f.execute({
        operation: "sketch.construction.set",
        draft: inspected.discovery!.state.draft,
        target,
        construction: true,
        intent: "fulfill",
      });
      expect(noChange.outcome).toEqual({
        kind: "completed",
        change: "unchanged",
      });
      expect(noChange.discovery!.history).toEqual(history);
    } finally {
      await f.close();
    }
  }, 90_000);
  it("reopens a published edge, changes construction as one private action, restores it and discards without changing the solid", async () => {
    const f = await createPlateWorkflow();
    try {
      const sketchId = f.published.discovery!.sketch!.sketchId!;
      const opened = await f.execute({ operation: "sketch.open", sketchId });
      const edge = opened.discovery!.sketch!.entities[0]!;
      const target = {
        kind: "sketchEntity",
        sketchId,
        entityId: edge.entityId,
      };
      const command = {
        version: 1,
        commandId: "construction-contract",
        operation: "sketch.construction.set",
        basis: {
          documentId: opened.discovery!.state.documentId,
          revisionId: opened.discovery!.state.revisionId,
          repositoryHeads: opened.discovery!.state.repositoryHeads,
        },
        draft: opened.discovery!.state.draft,
        target,
        construction: true,
        intent: "fulfill",
      };
      expect(validateSemanticCommand(command).success).toBe(true);
      const changed = await f.execute({
        operation: command.operation,
        draft: command.draft,
        target,
        construction: true,
        intent: "fulfill",
      });
      expect(
        changed.discovery!.sketch!.entities.find(
          (e) => e.entityId === edge.entityId,
        )?.construction,
      ).toBe(true);
      expect(changed.discovery!.sketch!.profiles).toEqual([]);
      expect(changed.discovery!.history!.undoEntries?.at(-1)?.label).toBe(
        "Construction",
      );
      expect(validateSemanticResult(changed.correlation, changed).success).toBe(
        true,
      );
      const undo = await f.execute({
        operation: "history.undo",
        draft: changed.discovery!.state.draft,
      });
      expect(
        undo.discovery!.sketch!.entities.find(
          (e) => e.entityId === edge.entityId,
        )?.construction,
      ).toBe(false);
      expect(undo.discovery!.sketch!.profiles).toHaveLength(1);
      const redo = await f.execute({
        operation: "history.redo",
        draft: undo.discovery!.state.draft,
      });
      expect(redo.discovery!.sketch!.profiles).toEqual([]);
      const discarded = await f.execute({
        operation: "sketch.discard",
        draft: redo.discovery!.state.draft,
      });
      expect(discarded.discovery!.model!.bodies[0]!.bounds).toEqual(
        f.solid.discovery!.model!.bodies[0]!.bounds,
      );
      const reopened = await f.execute({ operation: "sketch.open", sketchId });
      expect(
        reopened.discovery!.sketch!.entities.find(
          (e) => e.entityId === edge.entityId,
        )?.construction,
      ).toBe(false);
      expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
    } finally {
      await f.close();
    }
  }, 90_000);
});

import { test, expect } from "vitest";
import * as THREE from "three";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  createSketchSessionFromSnapshot,
  deleteSketchReferenceTarget,
  getSketchSessionDisplayRenderables,
  selectSketchReferenceTarget,
  toggleSketchConstructionTarget,
  updateSketchReferenceProjection,
} from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import { validateSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  bindRenderableObject,
  collectBindings,
  SURFACE_COLORS,
  updateWorkspaceHighlight,
} from "@/infrastructure/viewport/render-picking";

test("src/domain/editor/sketch-reference-geometry.spec.ts", () => {
  function createDefinition(): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        {
          pointId: "sketch_point_a",
          label: "A",
          target: {
            kind: "sketchPoint",
            sketchId: "sketch_primary",
            pointId: "sketch_point_a",
          },
          position: [0, 0],
          isConstruction: false,
        },
        {
          pointId: "sketch_point_b",
          label: "B",
          target: {
            kind: "sketchPoint",
            sketchId: "sketch_primary",
            pointId: "sketch_point_b",
          },
          position: [1, 0],
          isConstruction: false,
        },
      ],
      entityIds: ["sketch_entity_ab"],
      entities: [
        {
          kind: "lineSegment",
          entityId: "sketch_entity_ab",
          label: "AB",
          target: {
            kind: "sketchEntity",
            sketchId: "sketch_primary",
            entityId: "sketch_entity_ab",
          },
          isConstruction: false,
          startPointId: "sketch_point_a",
          endPointId: "sketch_point_b",
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
  }

  function createSession(definition: SketchDefinition = createDefinition()) {
    const plane = createStandardPlaneDefinition("xy");
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "bestEffort",
    });

    return createSketchSessionFromSnapshot({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_primary",
      ownerBodyId: null,
      sketchId: "sketch_primary",
      label: "Sketch",
      plane,
      planeTarget: plane.support,
      planeKey: "xy",
      sketch: {
        ownerDocumentId: "doc_workspace",
        ownerRevisionId: "rev_0001",
        ownerFeatureId: null,
        ownerSketchId: "sketch_primary",
        ownerBodyId: null,
        sketchId: "sketch_primary",
        label: "Sketch",
        planeSupport: plane.support,
        definition,
        solvedSnapshot: solved.solvedSnapshot,
        regions: [],
      },
    } satisfies SketchSnapshotRecord);
  }

  function testReferenceAuthoringPersistsInCommitRequest() {
    let session = beginSketchTool(createSession(), "projectReference");
    session = selectSketchReferenceTarget(session, {
      kind: "edge",
      bodyId: "body_seed",
      edgeId: "edge_seed",
    });

    expect(
      session.definition.referenceIds.length,
      "Accepted edge references should be authored on the sketch definition.",
    ).toBe(1);
    expect(
      session.definition.references[0]?.kind,
      "Model topology should create a model reference record.",
    ).toBe("modelReference");
    expect(
      session.commitRequest?.definition.references[0]?.referenceId,
      "Reference additions should flow into the sketch commit payload.",
    ).toBe(session.definition.references[0]?.referenceId);

    const reopened = createSession(session.commitRequest!.definition);
    expect(
      reopened.definition.references.length,
      "Reopened sketch sessions should preserve authored references.",
    ).toBe(1);
  }

  function testFaceBackedReopenPreservesNullPlaneKeyInCommitRequest() {
    const plane = {
      ...createStandardPlaneDefinition("xy"),
      support: {
        kind: "face" as const,
        bodyId: "body_seed" as const,
        faceId: "face_seed" as const,
      },
      key: null,
    };
    const solved = solveSketchDefinitionCore({
      definition: createDefinition(),
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "bestEffort",
    });
    const session = createSketchSessionFromSnapshot({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_face",
      ownerBodyId: null,
      sketchId: "sketch_face",
      label: "Face Sketch",
      plane,
      sketch: {
        ownerDocumentId: "doc_workspace",
        ownerRevisionId: "rev_0001",
        ownerFeatureId: null,
        ownerSketchId: "sketch_face",
        ownerBodyId: null,
        sketchId: "sketch_face",
        label: "Face Sketch",
        planeSupport: plane.support,
        definition: createDefinition(),
        solvedSnapshot: solved.solvedSnapshot,
        regions: [],
      },
    } satisfies SketchSnapshotRecord);

    expect(
      session.plane.key,
      "Face-backed reopened sketches should preserve a null authored plane key.",
    ).toBe(null);
    expect(
      session.commitRequest?.plane.key,
      "Face-backed reopened sketch commits should not default planeKey to XY.",
    ).toBe(null);
  }

  function testDuplicateReferencesAreRejected() {
    let session = beginSketchTool(createSession(), "projectReference");
    const target = {
      kind: "edge" as const,
      bodyId: "body_seed" as const,
      edgeId: "edge_seed" as const,
    };

    session = selectSketchReferenceTarget(session, target);
    session = beginSketchTool(session, "projectReference");
    session = selectSketchReferenceTarget(session, target);

    expect(
      session.definition.references.length,
      "Duplicate external references should not be appended.",
    ).toBe(1);
    expect(
      session.validationMessage?.includes("already authored"),
      "Duplicate rejection should surface explicit feedback.",
    ).toBeTruthy();
  }

  function testInvalidReferenceDiagnosticsStayExplicit() {
    const definition = {
      ...createDefinition(),
      referenceIds: ["ref_missing"],
      references: [],
    } satisfies SketchDefinition;
    const validation = validateSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
    });

    expect(
      validation.isValid,
      "Invalid reference order should fail validation.",
    ).toBeFalsy();
    expect(
      validation.diagnostics.some(
        (diagnostic) => diagnostic.code === "reference-missing-from-records",
      ),
      "Invalid references should report a stable diagnostic code.",
    ).toBeTruthy();
  }

  function testDuplicateReferenceRecordsAreRejected() {
    const reference = {
      referenceId: "ref_duplicate",
      kind: "modelReference",
      label: "Reference edge",
      source: { kind: "edge", bodyId: "body_seed", edgeId: "edge_seed" },
      projectionMode: "projectAlongPlaneNormal",
    } satisfies SketchDefinition["references"][number];
    const validation = validateSketchDefinitionCore({
      definition: {
        ...createDefinition(),
        referenceIds: ["ref_duplicate"],
        references: [reference, reference],
      },
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
    });

    expect(
      validation.isValid,
      "Duplicate reference records should fail validation.",
    ).toBeFalsy();
    expect(
      validation.diagnostics.some(
        (diagnostic) => diagnostic.code === "duplicate-reference-record",
      ),
      "Duplicate reference records should report a stable diagnostic code.",
    ).toBeTruthy();
  }

  function testProjectionRenderablesAreReadOnlyReferenceTargets() {
    const projected: ProjectedSketchReferenceRecord = {
      referenceId: "ref_1_edge",
      status: "projected",
      diagnostics: [],
      geometry: [
        {
          geometryId: "projected_geometry_ref_1_edge_0",
          kind: "lineSegment",
          startPosition: [0, 0],
          endPosition: [2, 0],
        },
      ],
    };
    let session = updateSketchReferenceProjection(
      createSession(),
      [projected],
      [],
    );
    const renderable = getSketchSessionDisplayRenderables(session).find(
      (entry) => entry.target?.kind === "projectedReferenceGeometry",
    );

    expect(
      renderable,
      "Projected reference geometry should produce a viewport renderable.",
    ).toBeTruthy();
    expect(
      renderable.role,
      "Projected reference renderables should use read-only reference styling.",
    ).toBe("reference");

    session = beginSketchGeometryDrag(session, renderable.target!, [0, 0]);
    expect(
      session.activeDrag,
      "Projected reference geometry should not start direct sketch dragging.",
    ).toBe(null);

    const toggled = toggleSketchConstructionTarget(
      beginSketchTool(session, "construction"),
      renderable.target!,
    );
    expect(
      toggled.definition.references.length,
      "Projected reference geometry should not be toggled into sketch-owned construction geometry.",
    ).toBe(session.definition.references.length);
  }

  function testFailedProjectionReferencesProduceDeletableMarkers() {
    let session = beginSketchTool(createSession(), "projectReference");
    session = selectSketchReferenceTarget(session, {
      kind: "edge",
      bodyId: "body_seed",
      edgeId: "edge_seed",
    });
    session = updateSketchReferenceProjection(
      session,
      [
        {
          referenceId: session.definition.referenceIds[0]!,
          status: "unsupportedSource",
          geometry: [],
          diagnostics: [
            {
              code: "unsupported-model-reference-source",
              severity: "warning",
              message: "No source geometry is available.",
              target: null,
            },
          ],
        },
      ],
      [],
    );

    const marker = getSketchSessionDisplayRenderables(session).find(
      (entry) => entry.target?.kind === "sketchExternalReference",
    );

    expect(
      marker,
      "Failed or empty reference projections should produce a selectable reference marker.",
    ).toBeTruthy();
    expect(
      marker.role,
      "Reference markers should use read-only reference styling.",
    ).toBe("reference");

    const deleted = deleteSketchReferenceTarget(session, marker.target!);
    expect(
      deleted.definition.references.length,
      "Deleting a reference marker should remove the authored reference.",
    ).toBe(0);
    expect(
      deleted.commitRequest?.definition.references.length,
      "Reference marker deletion should flow into the sketch commit payload.",
    ).toBe(0);
  }

  function testReferenceHighlightRefreshKeepsReferenceColor() {
    const target = {
      kind: "sketchExternalReference",
      referenceId: "ref_style",
    } as const;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
      ]),
      new THREE.LineBasicMaterial({ color: SURFACE_COLORS.sketchReference }),
    );
    const root = new THREE.Group();
    root.add(line);
    bindRenderableObject(line, null, target, "sketchReference", "document");

    const bindings = collectBindings(root);
    expect(
      bindings,
      "Reference style test should collect the bound line.",
    ).toBeTruthy();

    updateWorkspaceHighlight(bindings.targetToObjects, [], target);
    updateWorkspaceHighlight(bindings.targetToObjects, [], null);

    const material = line.material;
    expect(
      Array.isArray(material),
      "Reference style test line should have one material.",
    ).toBeFalsy();
    expect(
      material.color.getHex(),
      "Reference geometry should keep its distinct inactive color after highlight refresh.",
    ).toBe(SURFACE_COLORS.sketchReference);

    line.geometry.dispose();
    material.dispose();
  }

  function testSketchDatumRenderablesStayReadOnlyAndSelectable() {
    const session = createSession();
    const renderables = getSketchSessionDisplayRenderables(session);
    const origin = renderables.find(
      (entry) =>
        entry.target?.kind === "sketchDatumReference" &&
        entry.target.datumId === "origin",
    );
    const xAxis = renderables.find(
      (entry) =>
        entry.target?.kind === "sketchDatumReference" &&
        entry.target.datumId === "xAxis",
    );
    const yAxis = renderables.find(
      (entry) =>
        entry.target?.kind === "sketchDatumReference" &&
        entry.target.datumId === "yAxis",
    );

    expect(
      origin && xAxis && yAxis,
      "Active sketch sessions should expose origin, X-axis, and Y-axis datum renderables.",
    ).toBeTruthy();
    expect(
      origin.role === "reference" &&
        xAxis.role === "reference" &&
        yAxis.role === "reference",
      "Sketch datum renderables should use read-only reference styling.",
    ).toBeTruthy();

    const dragged = beginSketchGeometryDrag(session, origin.target!, [0, 0]);
    expect(
      dragged.activeDrag,
      "Sketch datum origin should not start direct sketch dragging.",
    ).toBe(null);

    const toggled = toggleSketchConstructionTarget(
      beginSketchTool(session, "construction"),
      xAxis.target!,
    );
    expect(
      toggled.definition.entities.length,
      "Sketch datum axes should not toggle into authored construction geometry.",
    ).toBe(session.definition.entities.length);
  }

  testReferenceAuthoringPersistsInCommitRequest();
  testFaceBackedReopenPreservesNullPlaneKeyInCommitRequest();
  testDuplicateReferencesAreRejected();
  testInvalidReferenceDiagnosticsStayExplicit();
  testDuplicateReferenceRecordsAreRejected();
  testProjectionRenderablesAreReadOnlyReferenceTargets();
  testFailedProjectionReferencesProduceDeletableMarkers();
  testReferenceHighlightRefreshKeepsReferenceColor();
  testSketchDatumRenderablesStayReadOnlyAndSelectable();
});

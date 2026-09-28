import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { err, ok } from "neverthrow";
import { expect, test } from "vitest";

import boxFixture from "@/domain/modeling/occ/fixtures/topology-signatures/box.payload.json";
import {
  createKernelHistoryProbeSession,
  createMemoizedHistoryProbe,
  takePreparedActionPrefix,
} from "@/domain/import/kernel-history-probe";
import {
  createOccNativeExactBrepPayloadFromShimPayload,
  parseNativeShimPayloadJson,
} from "@/domain/modeling/occ/native-topology-payload";
import { deriveKernelTopologySignaturesFromExactBrepPayload } from "@/domain/modeling/occ/topology-signatures";
import {
  createImportCapabilities,
  TopologyApplyRematchError,
} from "@/domain/import/orchestrator";
import type { BodyId, DocumentId, RevisionId, SketchEntityId } from "@/contracts/shared/ids";

import type { ImportPreparedActions } from "@/contracts/import/actions";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import { translateSketch } from "@/domain/import/onshape/sketch-translator";
function makeSnapshot(revisionId: RevisionId, bodies: readonly { bodyId: BodyId }[]) {
  return {
    document: {
      documentId: "doc_probe" as DocumentId,
      revisionId,
      settings: { modelingTolerance: 1e-3, angularToleranceRadians: 1e-4 },
      bodies: bodies.map((body) => {
        const derived = deriveKernelTopologySignaturesFromExactBrepPayload(
          makeExactPayload(body.bodyId),
        );
        const signatures = derived.status === "available" ? derived.signatures : [];
        return {
          bodyId: body.bodyId,
          topology: {
            faceIds: signatures.flatMap((entry) =>
              entry.reference.kind === "face" ? [entry.reference.faceId] : [],
            ),
            edgeIds: signatures.flatMap((entry) =>
              entry.reference.kind === "edge" ? [entry.reference.edgeId] : [],
            ),
            vertexIds: signatures.flatMap((entry) =>
              entry.reference.kind === "vertex" ? [entry.reference.vertexId] : [],
            ),
          },
        };
      }),
    },
  } as never;
}

function makeExactPayload(bodyId: BodyId) {
  return createOccNativeExactBrepPayloadFromShimPayload({
    revisionId: "rev_probe_exact" as RevisionId,
    target: { kind: "body", bodyId },
    bodyId,
    bodyLabel: bodyId,
    nativePayload: parseNativeShimPayloadJson(JSON.stringify(boxFixture.exactBrep)),
  });
}

function createRevisionAgnosticRealSolver(): SketchSolverAdapter {
  return new Proxy({} as SketchSolverAdapter, {
    get(_target, property) {
      return (request: { documentId: DocumentId; revisionId: RevisionId }) => {
        const adapter = new SketchConstraintSolverAdapter({
          neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
          documentId: request.documentId,
          revisionId: request.revisionId,
        });
        const method = (adapter as unknown as Record<string, unknown>)[
          property as string
        ] as (input: unknown) => unknown;
        return method.call(adapter, request);
      };
    },
  });
}

function sketchExtrudeCandidate(documentId: DocumentId): ImportPreparedActions {
  const translation = translateSketch({
    featureId: "probe_square",
    label: "Probe square",
    planeKey: "xy",
    entities: [
      { entityId: "e1", entityType: "lineSegment", start: [-1, -1], end: [1, -1] },
      { entityId: "e2", entityType: "lineSegment", start: [1, -1], end: [1, 1] },
      { entityId: "e3", entityType: "lineSegment", start: [1, 1], end: [-1, 1] },
      { entityId: "e4", entityType: "lineSegment", start: [-1, 1], end: [-1, -1] },
    ],
  });
  return {
    commitSketches: [
      {
        contractVersion: CONTRACT_VERSION,
        documentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        solverCorrelation: {
          requestId: "request_probe_sketch" as never,
          projectionRequestId: "request_probe_sketch_project" as never,
          validationRequestId: "request_probe_sketch_validate" as never,
          solveRequestId: "request_probe_sketch_solve" as never,
          regionRequestId: "request_probe_sketch_regions" as never,
        },
        sketchId: null,
        sketchLabel: "Probe square",
        plane: translation.plane,
        definition: translation.definition,
      },
    ],
    createFeatures: [
      {
        contractVersion: CONTRACT_VERSION,
        documentId,
        baseRevisionId: "rev_ignored" as RevisionId,
        featureLabel: "Probe extrude",
        definition: {
          kind: "extrude",
          featureTypeVersion: "feature-type/extrude/v1alpha2",
          parameters: {
            resultBodyType: "solid",
            profiles: [
              {
                kind: "regionOf",
                actionIndex: 0,
                selector: { kind: "interiorPoint", point: [0, 0] },
              },
            ],
            startExtent: { kind: "profilePlane" },
            extent: {
              mode: "oneSide",
              end: {
                kind: "blind",
                direction: "positive",
                distance: { source: "literal", value: 1 },
              },
            },
            operation: { source: "literal", value: "newBody" },
            booleanScope: { kind: "standalone" },
          },
        },
      },
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
    ],
  };
}


test("kernel history probe materializes deferred sketch-region extrudes", async () => {
  const documentId = "doc_workspace" as DocumentId;
  const service = createModelingService(
    new MockKernelAdapter({ solverAdapter: createRevisionAgnosticRealSolver() }),
    { currentDocumentId: documentId },
  );
  const probe = createKernelHistoryProbeSession({
    service: {
      ...service,
      async buildNativeExactBrepPayload(_input) {
        return {
          kind: "nativeTopologyPayload" as const,
          payload: makeExactPayload("body_signature_fixture_box" as BodyId),
          diagnostics: [],
        };
      },
    },
  });

  const result = await probe.evaluateHistoryProbe({
    actions: sketchExtrudeCandidate(documentId),
  });

  expect(result.steps).toHaveLength(2);
  expect(result.steps[0]?.status).toBe("rebuilt");
  expect(result.steps[1]?.status).toBe("rebuilt");
  expect(
    result.steps[1]?.status === "rebuilt" &&
      result.steps[1].signatures.some((signature) => signature.entityClass === "face"),
    "The extrude step should materialize regionOf inside the probe and contribute solid topology signatures.",
  ).toBeTruthy();
});


test("kernel history probe awaits async disposal of a retained successful session", async () => {
  let beginDispose: (() => void) | undefined;
  let releaseDispose: (() => void) | undefined;
  const disposeStarted = new Promise<void>((resolve) => {
    beginDispose = resolve;
  });
  const disposeFinished = new Promise<void>((resolve) => {
    releaseDispose = resolve;
  });
  const probe = createKernelHistoryProbeSession({
    createService() {
      return {
        dispose() {
          beginDispose?.();
          return disposeFinished;
        },
      } as never;
    },
  });

  await expect(probe.evaluateHistoryProbe({ actions: {} })).resolves.toEqual({ steps: [] });
  const disposal = probe.dispose!();
  await disposeStarted;
  let settled = false;
  void disposal.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);

  releaseDispose?.();
  await disposal;
});

// Lane: logic. Seam: exact prepared-action prefix evaluations reuse one
// isolated kernel session, while a changed prefix disposes it and starts fresh.
test("kernel history probe continues exact prefix extensions and restarts on divergence", async () => {
  const documentId = "doc_workspace" as DocumentId;
  const fullActions = sketchExtrudeCandidate(documentId);
  const firstPrefix = takePreparedActionPrefix(fullActions, 1);
  let serviceCount = 0;
  let sketchCalls = 0;
  let featureCalls = 0;
  let disposeCalls = 0;
  let snapshotCalls = 0;
  const probe = createKernelHistoryProbeSession({
    createService() {
      serviceCount += 1;
      const service = createModelingService(
        new MockKernelAdapter({ solverAdapter: createRevisionAgnosticRealSolver() }),
        { currentDocumentId: documentId },
      );
      return {
        ...service,
        getCurrentDocumentSnapshot() {
          snapshotCalls += 1;
          return service.getCurrentDocumentSnapshot();
        },
        commitSketch(input) {
          sketchCalls += 1;
          return service.commitSketch(input);
        },
        createFeature(input) {
          featureCalls += 1;
          return service.createFeature(input);
        },
        async buildNativeExactBrepPayload(_input) {
          return {
            kind: "nativeTopologyPayload" as const,
            payload: makeExactPayload("body_signature_fixture_box" as BodyId),
            diagnostics: [],
          };
        },
        dispose() {
          disposeCalls += 1;
          service.dispose();
        },
      };
    },
  });

  await probe.evaluateHistoryProbe({
    actions: firstPrefix,
    requestedSignatureStepOrdinals: [0],
  });
  await probe.evaluateHistoryProbe({
    actions: fullActions,
    requestedSignatureStepOrdinals: [0, 1],
  });
  expect({ serviceCount, sketchCalls, featureCalls, snapshotCalls, disposeCalls }).toEqual({
    serviceCount: 1,
    sketchCalls: 1,
    featureCalls: 1,
    snapshotCalls: 4,
    disposeCalls: 0,
  });

  await probe.evaluateHistoryProbe({
    actions: fullActions,
    requestedSignatureStepOrdinals: [0, 1],
    requireFreshExecution: true,
  });
  expect({ serviceCount, sketchCalls, featureCalls, snapshotCalls, disposeCalls }).toEqual({
    serviceCount: 2,
    sketchCalls: 2,
    featureCalls: 2,
    snapshotCalls: 8,
    disposeCalls: 1,
  });

  const divergent = structuredClone(fullActions);
  divergent.createFeatures![0]!.featureLabel = "Changed probe extrude";
  await probe.evaluateHistoryProbe({
    actions: divergent,
    requestedSignatureStepOrdinals: [0, 1],
  });
  expect({ serviceCount, sketchCalls, featureCalls, snapshotCalls, disposeCalls }).toEqual({
    serviceCount: 3,
    sketchCalls: 3,
    featureCalls: 3,
    snapshotCalls: 12,
    disposeCalls: 2,
  });

  await probe.dispose?.();
  expect(disposeCalls).toBe(3);
});

// Lane: logic. Seam: extending a retained prefix can bind a historical selector
// from exact signatures sampled internally even when they were omitted from output.
test("kernel history probe reuses an internally sampled historical witness", async () => {
  const bodyId = "body_apply_probe" as BodyId;
  const payload = makeExactPayload(bodyId);
  const derived = deriveKernelTopologySignaturesFromExactBrepPayload(payload);
  if (derived.status !== "available") throw new Error("Expected exact witness signatures.");
  const witness = derived.signatures.find((signature) => signature.entityClass === "face")!;
  const selector = {
    kind: "historicalTopologyOf" as const,
    expectedKind: "face" as const,
    capturedSignature: {
      entityClass: witness.entityClass,
      geometryType: witness.geometryType,
      definingData: witness.definingData,
      centroid: witness.centroid,
      boundingBox: witness.boundingBox,
    },
    witnessActionIndex: 0,
    source: {
      consumerFeatureId: "consumer",
      parameterId: "reference",
      deterministicId: "historical-face",
    },
  };
  const first: ImportPreparedActions = {
    createFeatures: [{ requestId: "witness" } as never],
    orderedActions: [{ kind: "createFeature", index: 0 }],
  };
  const extended: ImportPreparedActions = {
    createFeatures: [
      first.createFeatures![0]!,
      {
        definition: {
          kind: "plane",
          parameters: { mode: "coplanar", reference: { target: selector } },
        },
      } as never,
    ],
    orderedActions: [
      { kind: "createFeature", index: 0 },
      { kind: "createFeature", index: 1 },
    ],
  };
  let serviceCount = 0;
  let actionCalls = 0;
  const probe = createKernelHistoryProbeSession({
    createService() {
      serviceCount += 1;
      return {
        async getCurrentDocumentSnapshot() {
          return makeSnapshot(`rev_historical_${actionCalls}` as RevisionId, [{ bodyId }]);
        },
        async createFeature() {
          actionCalls += 1;
          return ok({
            revisionId: `rev_historical_${actionCalls}` as RevisionId,
            featureId: `feature_${actionCalls}`,
            changedTargets: [{ kind: "body", bodyId }],
            diagnostics: [],
            revisionState: { kind: "accepted" },
          }) as never;
        },
        async commitSketch() { return ok({}) as never; },
        async addDocumentVariable() { return ok({}) as never; },
        async buildNativeExactBrepPayload() {
          return { kind: "nativeTopologyPayload", payload, diagnostics: [] } as const;
        },
      } as never;
    },
  });

  await probe.evaluateHistoryProbe({ actions: first, requestedSignatureStepOrdinals: [] });
  const result = await probe.evaluateHistoryProbe({ actions: extended, requestedSignatureStepOrdinals: [] });

  expect(serviceCount).toBe(1);
  expect(actionCalls).toBe(2);
  expect(result.steps.every((step) => step.status === "rebuilt")).toBe(true);
  expect(JSON.stringify(selector)).not.toContain(bodyId);
});

function faceRefsOf(bodyId: BodyId) {
  const derived = deriveKernelTopologySignaturesFromExactBrepPayload(makeExactPayload(bodyId));
  if (derived.status !== "available") throw new Error("Expected exact face signatures.");
  return derived.signatures.flatMap((signature) =>
    signature.reference.kind === "face" ? [signature.reference] : [],
  );
}

/**
 * Profile sketch -> tool extrude -> Split -> two split-interface sketches
 * (the 9841 Sketch 3/4 shape). The fake kernel publishes exact native lineage
 * under the source keys the real OCC extrude and sheet-split stages emit. Like
 * OCC, it derives each tool side-face key from the entity ids the profile sketch
 * actually committed (never from a selector), with one distinct face per entity
 * and one distinct alias output per tool face, so a wrong or unauthored id
 * resolves nothing and a swapped id picks a different face. Split consumes the
 * tool body, so tool faces are only observable at the tool action itself.
 */
const PROFILE_ENTITY_E1 = "sketch_entity_probe_square_e1" as SketchEntityId;
const PROFILE_ENTITY_E2 = "sketch_entity_probe_square_e2" as SketchEntityId;

function makeSplitInterfaceScenario(options: {
  omitSplitAlias?: boolean;
  sketch3Entity?: string;
} = {}) {
  const toolBody = "body_split_tool" as BodyId;
  const splitBodies = ["body_split_a", "body_split_b"] as BodyId[];
  const toolFaces = faceRefsOf(toolBody);
  const outputFaces = faceRefsOf(splitBodies[0]!);
  const profileSketchId = "sketch_profile";
  const selector = (entity: string, consumer: string) => ({
    kind: "splitInterfaceFaceOf" as const,
    profileSketchActionIndex: 0,
    toolExtrudeActionIndex: 1,
    splitActionIndex: 2,
    profileEntityId: entity,
    endRole: "one-side-end" as const,
    source: { consumerFeatureId: consumer, parameterId: "plane", deterministicId: `split-interface:${consumer}` },
  });
  const profile = sketchExtrudeCandidate("doc_split" as DocumentId).commitSketches![0]!;
  const consumerSketch = (label: string, entity: string) => ({
    ...profile,
    sketchLabel: label,
    plane: { ...profile.plane, support: selector(entity, label) },
  }) as never;
  // Sketch 3 names e2 and Sketch 4 names e1, so neither consumer order nor
  // entity order can stand in for the authored id.
  const full: ImportPreparedActions = {
    commitSketches: [
      profile,
      consumerSketch("Sketch 3", options.sketch3Entity ?? PROFILE_ENTITY_E2),
      consumerSketch("Sketch 4", PROFILE_ENTITY_E1),
    ],
    createFeatures: [
      { featureLabel: "Tool extrude" } as never,
      { featureLabel: "Split 1" } as never,
      { featureLabel: "Tail" } as never,
    ],
    orderedActions: [
      { kind: "commitSketch", index: 0 },
      { kind: "createFeature", index: 0 },
      { kind: "createFeature", index: 1 },
      { kind: "commitSketch", index: 1 },
      { kind: "commitSketch", index: 2 },
      { kind: "createFeature", index: 2 },
    ],
  };
  const toolKey = (entity: string) =>
    `extrude:feature_tool:profile-sketch:${profileSketchId}:end:one-side-end:sketch-entity:${profileSketchId}:${entity}:generated-side-face`;
  const aliasKey = (toolFace: { faceId: string }) =>
    `sheet-split-tool-successor:feature_split:${toolBody}:face:${toolFace.faceId}`;
  const lineage = (featureId: string, outputSlot: BodyId, claims: [string, object][]) => ({
    featureId,
    outputs: [{
      outputSlot,
      topologyToken: `${featureId}-token`,
      topology: { faceIds: [], edgeIds: [], vertexIds: [] },
      sourceTargets: claims.map(([sourceKey, target]) => ({ sourceKey, targets: [target] })),
      unsupportedSourceKeys: [],
    }],
  });
  // Tool face i belongs to committed profile entity i; its Split alias is a
  // different output face, so tool and output ids cannot be confused.
  const aliasOutputOf = (toolFaceIndex: number) => outputFaces[toolFaceIndex + 1]!;

  const state = {
    serviceCount: 0,
    committedSupports: [] as { sketchLabel: string; support: unknown }[],
    committedProfileEntityIds: [] as string[],
  };
  const expectedOutputFace = (entity: string) => {
    const index = state.committedProfileEntityIds.indexOf(entity);
    if (index < 0) throw new Error(`Profile entity ${entity} was never committed.`);
    return aliasOutputOf(index);
  };
  const createService = () => {
    state.serviceCount += 1;
    let revision = 0;
    let bodies: BodyId[] = [];
    let features: string[] = [];
    let profileEntityIds: string[] = [];
    const accepted = (value: object) => {
      revision += 1;
      return ok({ revisionId: `rev_split_${revision}`, diagnostics: [], revisionState: { kind: "accepted" }, ...value });
    };
    return {
      async getCurrentDocumentSnapshot() {
        return makeSnapshot(`rev_split_${revision}` as RevisionId, bodies.map((bodyId) => ({ bodyId })));
      },
      async commitSketch(input: {
        sketchLabel: string;
        plane: { support: unknown };
        definition: { entities: readonly { entityId: string }[] };
      }) {
        state.committedSupports.push({ sketchLabel: input.sketchLabel, support: input.plane.support });
        if (input.sketchLabel === profile.sketchLabel) {
          profileEntityIds = input.definition.entities.map((entity) => entity.entityId);
          state.committedProfileEntityIds = profileEntityIds;
        }
        return accepted({ sketchId: input.sketchLabel === profile.sketchLabel ? profileSketchId : `sketch_${revision}` });
      },
      async createFeature(input: { featureLabel: string }) {
        if (input.featureLabel === "Tool extrude") {
          bodies = [toolBody];
          features = ["feature_tool"];
          return accepted({ featureId: "feature_tool", changedTargets: [{ kind: "body", bodyId: toolBody }] });
        }
        if (input.featureLabel === "Split 1") {
          bodies = [...splitBodies];
          features = ["feature_tool", "feature_split"];
          return accepted({
            featureId: "feature_split",
            changedTargets: splitBodies.map((bodyId) => ({ kind: "body", bodyId })),
          });
        }
        return accepted({ featureId: "feature_tail", changedTargets: [] });
      },
      async addDocumentVariable() {
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload(input: { target: { bodyId: BodyId } }) {
        const toolLineage = lineage("feature_tool", toolBody, profileEntityIds.map(
          (entity, index) => [toolKey(entity), toolFaces[index]!],
        ));
        const splitLineage = lineage("feature_split", splitBodies[0]!, options.omitSplitAlias
          ? []
          : profileEntityIds.map((_, index) => [aliasKey(toolFaces[index]!), aliasOutputOf(index)]));
        return {
          kind: "nativeTopologyPayload" as const,
          payload: {
            ...makeExactPayload(input.target.bodyId),
            topologyLineage: [
              ...(features.includes("feature_tool") && bodies.includes(toolBody) ? [toolLineage] : []),
              ...(features.includes("feature_split") ? [splitLineage] : []),
            ],
          },
          diagnostics: [],
        };
      },
    } as never;
  };
  const consumerSupports = () =>
    state.committedSupports.filter(({ sketchLabel }) => sketchLabel !== profile.sketchLabel);
  return { full, profile, consumerSketch, createService, state, consumerSupports, expectedOutputFace };
}

const stepOutcomes = (result: Awaited<ReturnType<ReturnType<typeof createKernelHistoryProbeSession>["evaluateHistoryProbe"]>>) =>
  result.steps.map((step) => step.status === "rebuilt" ? "rebuilt" : step.diagnostics[0]?.message);

const expectedSplitInterfaceSupports = (
  scenario: ReturnType<typeof makeSplitInterfaceScenario>,
) => [
  { sketchLabel: "Sketch 3", support: scenario.expectedOutputFace(PROFILE_ENTITY_E2) },
  { sketchLabel: "Sketch 4", support: scenario.expectedOutputFace(PROFILE_ENTITY_E1) },
];

// Lane: logic. Seam: the probe mirrors apply's split-interface lifecycle, so a
// sketch on a Split interface face commits on the exact output face bound from
// the tool action's exact side face, in fresh and continued probe sessions.
test("kernel history probe binds split-interface sketch planes to the exact split output face", async () => {
  const fresh = makeSplitInterfaceScenario();
  const freshResult = await createKernelHistoryProbeSession({ service: fresh.createService() })
    .evaluateHistoryProbe({ actions: fresh.full });
  expect(
    stepOutcomes(freshResult),
    "No probe step may fail with 'Split-interface face was not bound in this apply session'.",
  ).toEqual(["rebuilt", "rebuilt", "rebuilt", "rebuilt", "rebuilt", "rebuilt"]);
  expect(
    fresh.state.committedProfileEntityIds,
    "The fixture's selector ids must be the ids the profile sketch actually committed.",
  ).toEqual(expect.arrayContaining([PROFILE_ENTITY_E1, PROFILE_ENTITY_E2]));
  expect(
    fresh.consumerSupports(),
    "Each split-interface sketch must commit on the exact output face aliased from its own tool side face.",
  ).toEqual(expectedSplitInterfaceSupports(fresh));

  // Continuation from a prefix that ends before the tool: bindings happen as
  // the reused session resumes through the tool and Split actions.
  const continued = makeSplitInterfaceScenario();
  const continuedProbe = createKernelHistoryProbeSession({ createService: continued.createService });
  await continuedProbe.evaluateHistoryProbe({ actions: takePreparedActionPrefix(continued.full, 1) });
  const continuedResult = await continuedProbe.evaluateHistoryProbe({ actions: continued.full });
  expect(stepOutcomes(continuedResult)).toEqual(Array(6).fill("rebuilt"));
  expect(continued.state.serviceCount, "A resumable prefix continues in the same session.").toBe(1);
  expect(continued.consumerSupports()).toEqual(expectedSplitInterfaceSupports(continued));
  await continuedProbe.dispose?.();
});

// Lane: logic. Seam: the tool side-face key is the committed profile entity's
// authored id; a selector naming any other id (e.g. the former positional
// "c.1" label) resolves no tool face and fails at the tool action.
test("kernel history probe fails the tool step when the selector names an uncommitted profile entity", async () => {
  const scenario = makeSplitInterfaceScenario({ sketch3Entity: "c.1" });
  const result = await createKernelHistoryProbeSession({ service: scenario.createService() })
    .evaluateHistoryProbe({ actions: scenario.full });
  expect(stepOutcomes(result)).toEqual([
    "rebuilt",
    "History probe failed at step 2: Split-interface source extrude:feature_tool:profile-sketch:sketch_profile:end:one-side-end:sketch-entity:sketch_profile:c.1:generated-side-face resolved 0 tool faces, expected exactly one.",
  ]);
  expect(scenario.consumerSupports()).toEqual([]);
});

// Lane: logic. Seam: a retained session whose tool/Split actions were applied
// before the split-interface consumer was declared cannot recover the tool face
// (Split consumed the tool body), so it restarts fresh; an accepted session that
// already bound them keeps its bindings for later extensions.
test("kernel history probe restarts or retains split-interface bindings across reused sessions", async () => {
  const scenario = makeSplitInterfaceScenario();
  const probe = createKernelHistoryProbeSession({ createService: scenario.createService });

  const beforeConsumers = await probe.evaluateHistoryProbe({
    actions: takePreparedActionPrefix(scenario.full, 3),
  });
  expect(stepOutcomes(beforeConsumers)).toEqual(Array(3).fill("rebuilt"));
  expect(scenario.state.serviceCount).toBe(1);

  const withConsumers = await probe.evaluateHistoryProbe({
    actions: takePreparedActionPrefix(scenario.full, 5),
  });
  expect(
    stepOutcomes(withConsumers),
    "Split-interface sketches declared after their tool action must not fail as unbound.",
  ).toEqual(["rebuilt", "rebuilt", "rebuilt", "rebuilt", "rebuilt"]);
  expect(scenario.state.serviceCount, "Unbindable retained prefixes restart in a fresh session.").toBe(2);
  expect(scenario.consumerSupports()).toEqual(expectedSplitInterfaceSupports(scenario));

  const extended = await probe.evaluateHistoryProbe({ actions: scenario.full });
  expect(stepOutcomes(extended)).toEqual(Array(6).fill("rebuilt"));
  expect(scenario.state.serviceCount, "Accepted bindings survive an exact prefix extension.").toBe(2);
  await probe.dispose?.();
});

// Lane: logic. Seam: a retained prefix that ends after the tool but before the
// Split has already lost the tool face for a newly declared selector (it is
// bound only at the tool action), even though the Split has not run yet.
test("kernel history probe restarts a retained prefix that ends between the tool and the split", async () => {
  const scenario = makeSplitInterfaceScenario();
  const probe = createKernelHistoryProbeSession({ createService: scenario.createService });

  const throughTool = await probe.evaluateHistoryProbe({
    actions: takePreparedActionPrefix(scenario.full, 2),
  });
  expect(stepOutcomes(throughTool)).toEqual(["rebuilt", "rebuilt"]);
  expect(scenario.state.serviceCount).toBe(1);

  const result = await probe.evaluateHistoryProbe({ actions: scenario.full });
  expect(
    stepOutcomes(result),
    "The Split must not fail for want of a tool face the retained session never bound.",
  ).toEqual(Array(6).fill("rebuilt"));
  expect(scenario.state.serviceCount, "A tool applied before its selector was declared forces a fresh session.").toBe(2);
  expect(scenario.consumerSupports()).toEqual(expectedSplitInterfaceSupports(scenario));
  await probe.dispose?.();
});

// Lane: logic. Seam: a retained session whose registered split-interface
// declaration conflicts with the new input's declaration for the same selector
// key restarts, so the result matches a fresh apply of the new plan instead of
// throwing or reusing the stale binding.
test("kernel history probe restarts when a retained split-interface declaration conflicts", async () => {
  const scenario = makeSplitInterfaceScenario();
  const probe = createKernelHistoryProbeSession({ createService: scenario.createService });

  // Retained input declares Sketch 3 on e1 while only its producer chain is ordered.
  const stale: ImportPreparedActions = {
    ...scenario.full,
    commitSketches: [
      scenario.profile,
      scenario.consumerSketch("Sketch 3", PROFILE_ENTITY_E1),
      scenario.consumerSketch("Sketch 4", PROFILE_ENTITY_E1),
    ],
    orderedActions: scenario.full.orderedActions!.slice(0, 3),
  };
  const staleResult = await probe.evaluateHistoryProbe({ actions: stale });
  expect(stepOutcomes(staleResult)).toEqual(Array(3).fill("rebuilt"));
  expect(scenario.state.serviceCount).toBe(1);

  const result = await probe.evaluateHistoryProbe({ actions: scenario.full });
  expect(stepOutcomes(result)).toEqual(Array(6).fill("rebuilt"));
  expect(scenario.state.serviceCount, "A conflicting declaration forces a fresh session.").toBe(2);
  expect(
    scenario.consumerSupports(),
    "Sketch 3 must commit on e2's aliased face, not the stale e1 binding.",
  ).toEqual(expectedSplitInterfaceSupports(scenario));
  await probe.dispose?.();
});

// Lane: logic. Seam: like apply, a Split whose exact alias claim is missing
// fails at the Split step rather than at a downstream consumer.
test("kernel history probe fails the split step when its exact interface alias is missing", async () => {
  const scenario = makeSplitInterfaceScenario({ omitSplitAlias: true });
  const result = await createKernelHistoryProbeSession({ service: scenario.createService() })
    .evaluateHistoryProbe({ actions: scenario.full });
  expect(result.steps.map((step) => step.status)).toEqual(["rebuilt", "rebuilt", "failed"]);
  expect(result.steps[2]).toMatchObject({
    diagnostics: [{
      code: "kernel-history-probe-step-failed",
      message: expect.stringContaining("History probe failed at step 3: Split-interface alias sheet-split-tool-successor:feature_split:body_split_tool:face:"),
    }],
  });
  expect(scenario.consumerSupports()).toEqual([]);
});

test("kernel history probe awaits async service disposal after a failed evaluation", async () => {
  let beginDispose: (() => void) | undefined;
  let releaseDispose: (() => void) | undefined;
  const disposeStarted = new Promise<void>((resolve) => {
    beginDispose = resolve;
  });
  const disposeFinished = new Promise<void>((resolve) => {
    releaseDispose = resolve;
  });
  const probe = createKernelHistoryProbeSession({
    createService() {
      return {
        async getCurrentDocumentSnapshot() {
          return makeSnapshot("rev_probe_dispose" as RevisionId, []);
        },
        async createFeature() {
          throw new Error("probe action failed");
        },
        dispose() {
          beginDispose?.();
          return disposeFinished;
        },
      } as never;
    },
  });

  const evaluation = probe.evaluateHistoryProbe({
    actions: { createFeatures: [{ requestId: "request_dispose_failure" } as never] },
  });
  await disposeStarted;
  let settled = false;
  void evaluation.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);

  releaseDispose?.();
  await expect(evaluation).resolves.toMatchObject({
    steps: [{
      status: "failed",
      diagnostics: [{ message: "History probe failed at step 1: probe action failed" }],
    }],
  });
});

test("kernel history probe contains deferred materialization failures at their feature step", async () => {
  const documentId = "doc_workspace" as DocumentId;
  const actions = sketchExtrudeCandidate(documentId);
  const feature = actions.createFeatures?.[0];
  if (!feature || feature.definition.kind !== "extrude") {
    throw new Error("Expected the probe extrude fixture.");
  }
  feature.definition.parameters.profiles = [
    {
      kind: "regionOf",
      actionIndex: 0,
      selector: { kind: "interiorPoint", point: [100, 100] },
    },
  ];
  const service = createModelingService(
    new MockKernelAdapter({ solverAdapter: createRevisionAgnosticRealSolver() }),
    { currentDocumentId: documentId },
  );
  const probe = createKernelHistoryProbeSession({ service });

  const result = await probe.evaluateHistoryProbe({ actions });

  expect(result.steps[0]?.status).toBe("rebuilt");
  expect(result.steps[1]).toMatchObject({
    status: "failed",
    diagnostics: [
      {
        code: "kernel-history-probe-step-failed",
        message: expect.stringContaining("Unable to resolve deferred regionOf"),
      },
    ],
  });
});

test("kernel history probe derives body-only checkpoint signatures from render meshes", async () => {
  const bodyId = "body_checkpoint" as BodyId;
  const probe = createKernelHistoryProbeSession({
    service: {
      async getCurrentDocumentSnapshot() {
        return {
          document: {
            revisionId: "rev_checkpoint" as RevisionId,
            bodies: [{ bodyId, topologyPresentation: "bodyOnlyMesh" }],
            render: {
              records: [{
                ownerBodyId: bodyId,
                geometry: {
                  kind: "mesh",
                  vertexPositions: [[0, 0, 0], [2, 4, 6]],
                },
              }],
            },
          },
        } as never;
      },
      async createFeature() {
        return ok({ changedTargets: [{ kind: "body", bodyId }] }) as never;
      },
      async commitSketch() {
        return ok({}) as never;
      },
      async addDocumentVariable() {
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload() {
        throw new Error("body-only checkpoints must not request native topology");
      },
    },
  });

  const result = await probe.evaluateHistoryProbe({
    actions: { createFeatures: [{ requestId: "request_checkpoint" } as never] },
  });

  expect(result.steps).toEqual([{
    status: "rebuilt",
    signatures: [{
      entityClass: "body",
      geometryType: "solid",
      boundingBox: { low: [0, 0, 0], high: [2, 4, 6] },
      centroid: [1, 2, 3],
      reference: { kind: "body", bodyId },
    }],
  }]);
});

test("kernel history probe rebuilds in the provided isolated session without touching an open document", async () => {
  const openDocumentState = structuredClone(
    makeSnapshot("rev_open" as RevisionId, [{ bodyId: "body_open" as BodyId }]),
  );
  const isolatedCalls: string[] = [];
  let isolatedSnapshot = makeSnapshot("rev_probe_0" as RevisionId, []);
  const probe = createKernelHistoryProbeSession({
    service: {
      async getCurrentDocumentSnapshot() {
        isolatedCalls.push("snapshot");
        return isolatedSnapshot;
      },
      async createFeature() {
        isolatedCalls.push("createFeature");
        isolatedSnapshot = makeSnapshot("rev_probe_1" as RevisionId, [
          { bodyId: "body_probe" as BodyId },
        ]);
        return ok({}) as never;
      },
      async commitSketch() {
        isolatedCalls.push("commitSketch");
        return ok({}) as never;
      },
      async addDocumentVariable() {
        isolatedCalls.push("addDocumentVariable");
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload() {
        isolatedCalls.push("exactBrep");
        return {
          kind: "nativeTopologyPayload",
          payload: makeExactPayload("body_probe" as BodyId),
          diagnostics: [],
        };
      },
    },
  });

  const result = await probe.evaluateHistoryProbe({
    actions: {
      createFeatures: [
        {
          requestId: "request_probe_feature",
          featureId: "feature_probe" as never,
          definition: { kind: "deleteSolid", target: { kind: "body", bodyId: "body_probe" as BodyId } } as never,
        },
      ],
    },
  });

  expect(result.steps).toHaveLength(1);
  expect(result.steps[0]?.status).toBe("rebuilt");
  expect(result.steps[0]?.status === "rebuilt" && result.steps[0].signatures.length > 0).toBeTruthy();
  expect(openDocumentState).toEqual(
    makeSnapshot("rev_open" as RevisionId, [{ bodyId: "body_open" as BodyId }]),
  );
  expect(isolatedCalls).toContain("createFeature");
  expect(isolatedCalls).toContain("exactBrep");
});

test("kernel history probe returns completed prefix results and failing-step diagnostics", async () => {
  let revision = 0;
  const probe = createKernelHistoryProbeSession({
    service: {
      async getCurrentDocumentSnapshot() {
        return makeSnapshot(`rev_probe_${revision}` as RevisionId, [
          { bodyId: "body_probe" as BodyId },
        ]);
      },
      async createFeature() {
        revision += 1;
        if (revision === 1) {
          return ok({}) as never;
        }
        return err(new Error("boom")) as never;
      },
      async commitSketch() {
        return ok({}) as never;
      },
      async addDocumentVariable() {
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload() {
        return {
          kind: "nativeTopologyPayload",
          payload: makeExactPayload("body_probe" as BodyId),
          diagnostics: [],
        };
      },
    },
  });

  const result = await probe.evaluateHistoryProbe({
    actions: {
      createFeatures: [{ requestId: "request_ok" } as never, { requestId: "request_fail" } as never],
    },
  });

  expect(result.steps).toHaveLength(2);
  expect(result.steps[0]?.status).toBe("rebuilt");
  expect(result.steps[1]).toEqual({
    status: "failed",
    diagnostics: [
      {
        severity: "error",
        code: "kernel-history-probe-step-failed",
        message: "History probe failed at step 2: boom",
      },
    ],
  });
});


test("kernel history probe samples exact evidence at every step while filtering signature output", async () => {
  const actions: ImportPreparedActions = {
    createFeatures: [
      { requestId: "one" } as never,
      { requestId: "two" } as never,
      { requestId: "three" } as never,
    ],
  };
  const evaluate = async (requestedSignatureStepOrdinals?: readonly number[]) => {
    let snapshotCalls = 0;
    let exactPayloadCalls = 0;
    const probe = createKernelHistoryProbeSession({
      service: {
        async getCurrentDocumentSnapshot() {
          snapshotCalls += 1;
          return makeSnapshot("rev_sampling" as RevisionId, [
            { bodyId: "body_sampling" as BodyId },
          ]);
        },
        async createFeature() {
          return ok({}) as never;
        },
        async commitSketch() {
          return ok({}) as never;
        },
        async addDocumentVariable() {
          return ok({}) as never;
        },
        async buildNativeExactBrepPayload() {
          exactPayloadCalls += 1;
          return {
            kind: "nativeTopologyPayload" as const,
            payload: makeExactPayload("body_sampling" as BodyId),
            diagnostics: [],
          };
        },
      },
    });
    const result = await probe.evaluateHistoryProbe({
      actions,
      ...(requestedSignatureStepOrdinals === undefined
        ? {}
        : { requestedSignatureStepOrdinals }),
    });
    return { result, snapshotCalls, exactPayloadCalls };
  };

  const legacy = await evaluate();
  const legacySignatureCounts = legacy.result.steps.map((step) =>
    step.status === "rebuilt" ? step.signatures.length : 0,
  );
  expect(legacySignatureCounts.every((count) => count > 0)).toBe(true);
  expect(legacy).toMatchObject({ snapshotCalls: 4, exactPayloadCalls: 3 });

  const selected = await evaluate([1]);
  expect(
    selected.result.steps.map((step) =>
      step.status === "rebuilt" ? step.signatures.length : 0,
    ),
  ).toEqual([0, legacySignatureCounts[1], 0]);
  expect(selected).toMatchObject({ snapshotCalls: 4, exactPayloadCalls: 3 });

  const empty = await evaluate([]);
  expect(
    empty.result.steps.map((step) => ({
      status: step.status,
      signatures: step.status === "rebuilt" ? step.signatures : [],
      hasExactEvidence: step.status === "rebuilt" && Boolean(step.exactTopologyEvidence),
    })),
  ).toEqual([
    { status: "rebuilt", signatures: [], hasExactEvidence: true },
    { status: "rebuilt", signatures: [], hasExactEvidence: true },
    { status: "rebuilt", signatures: [], hasExactEvidence: true },
  ]);
  expect(empty).toMatchObject({ snapshotCalls: 4, exactPayloadCalls: 3 });
});

test("kernel history probe contains topology rematch failures only when requested", async () => {
  const selector = {
    kind: "topologyOf" as const,
    expectedKind: "body" as const,
    capturedSignature: {} as never,
    tolerance: {} as never,
    source: {
      consumerFeatureId: "consumer-feature",
      parameterId: "parts",
      deterministicId: "selector-id",
    },
  };
  const createProbe = () => {
    let actionCalls = 0;
    return createKernelHistoryProbeSession({
      createService() {
        return {
          async getCurrentDocumentSnapshot() {
            return makeSnapshot("rev_rematch" as RevisionId, [
              { bodyId: "body_rematch" as BodyId },
            ]);
          },
          async createFeature() {
            actionCalls += 1;
            if (actionCalls === 2) {
              throw new TopologyApplyRematchError(selector, "live candidates: none");
            }
            return ok({}) as never;
          },
          async commitSketch() {
            return ok({}) as never;
          },
          async addDocumentVariable() {
            return ok({}) as never;
          },
          async buildNativeExactBrepPayload() {
            return {
              kind: "nativeTopologyPayload" as const,
              payload: makeExactPayload("body_rematch" as BodyId),
              diagnostics: [],
            };
          },
        } as never;
      },
    });
  };
  const actions: ImportPreparedActions = {
    createFeatures: [
      { requestId: "first" } as never,
      { requestId: "second" } as never,
    ],
  };

  await expect(createProbe().evaluateHistoryProbe({ actions })).rejects.toThrow(
    "Live topology rematch failed for consumer-feature:parts:selector-id.",
  );

  const contained = await createProbe().evaluateHistoryProbe({
    actions,
    containTopologyRematchFailures: true,
  });
  expect(contained.steps[0]?.status).toBe("rebuilt");
  expect(contained.steps[1]).toEqual({
    status: "failed",
    diagnostics: [{
      severity: "error",
      code: "topology-apply-rematch-failed",
      message:
        "History probe topology rematch failed at step 2 for consumer-feature:parts:selector-id: live candidates: none",
    }],
  });
});

// Lane: logic (per docs/testing.md — non-UI behavior at an exported domain
// boundary). Seam: the probe's acceptance rule must equal apply's. A kernel
// result whose Result envelope is Ok but that carries an error diagnostic (or a
// non-accepted revision state) is REFUSED by apply via
// `requireAcceptedModelingResult`. If the probe accepted it, review would
// promote a feature that commit then rejects, aborting the whole studio instead
// of baking that one feature. This is the 9841 `Chamfer 2` class: an earlier
// feature's conservative stage history invalidates the edges it selects, which
// surfaces only as an `occ-topology-unsupported-history` error diagnostic.
test("kernel history probe fails a step whose result apply would refuse", async () => {
  const rejectingProbe = (value: unknown) =>
    createKernelHistoryProbeSession({
      service: {
        async getCurrentDocumentSnapshot() {
          return makeSnapshot("rev_probe_reject" as RevisionId, []);
        },
        async createFeature() {
          return ok(value) as never;
        },
        async commitSketch() {
          return ok({}) as never;
        },
        async addDocumentVariable() {
          return ok({}) as never;
        },
        async buildNativeExactBrepPayload() {
          return { kind: "nativeTopologyPayload", payload: makeExactPayload("body_probe" as BodyId), diagnostics: [] };
        },
      },
    });
  const actions = { createFeatures: [{ requestId: "request_rejected" } as never] };

  const invalidated = await rejectingProbe({
    revisionState: { kind: "accepted" },
    diagnostics: [
      {
        severity: "error",
        code: "occ-topology-unsupported-history",
        message: "Chamfer 2 edge selection is incorrect.",
        target: {
          kind: "edge",
          bodyId: "body_probe" as BodyId,
          edgeId: "edge_body_probe_g1",
        },
      },
    ],
  }).evaluateHistoryProbe({ actions });
  expect(invalidated.steps[0]?.status).toBe("failed");
  expect(
    invalidated.steps[0]?.status === "failed"
      ? invalidated.steps[0].diagnostics[0]?.message
      : null,
    "The kernel's own invalidation reason must survive into the probe diagnostic.",
  ).toContain("occ-topology-unsupported-history: Chamfer 2 edge selection is incorrect.");
  // The authored-field message names no reference, so a stage-lineage refusal is
  // unattributable without the refused durable target.
  expect(
    invalidated.steps[0]?.status === "failed"
      ? invalidated.steps[0].diagnostics[0]?.message
      : null,
    "The refused durable target must survive into the probe diagnostic, or the offending entity has to be guessed.",
  ).toContain("[refused target edge edge_body_probe_g1]");

  const rejectedRevision = await rejectingProbe({
    revisionState: { kind: "rejected" },
    diagnostics: [],
  }).evaluateHistoryProbe({ actions });
  expect(rejectedRevision.steps[0]?.status).toBe("failed");

  // An accepted result with only non-error diagnostics still rebuilds, so this
  // does not make the probe pessimistic.
  const accepted = await rejectingProbe({
    revisionState: { kind: "accepted" },
    diagnostics: [{ severity: "warning", code: "noise", message: "noise" }],
  }).evaluateHistoryProbe({ actions });
  expect(accepted.steps[0]?.status).toBe("rebuilt");
});
test("import capabilities expose the real kernel history probe when platform composition supplies it", async () => {
  const probe = createKernelHistoryProbeSession({
    service: {
      async getCurrentDocumentSnapshot() {
        return makeSnapshot("rev_probe_0" as RevisionId, []);
      },
      async createFeature() {
        return ok({}) as never;
      },
      async commitSketch() {
        return ok({}) as never;
      },
      async addDocumentVariable() {
        return ok({}) as never;
      },
      async buildNativeExactBrepPayload() {
        return {
          kind: "nativeTopologyPayload",
          payload: makeExactPayload("body_probe" as BodyId),
          diagnostics: [],
        };
      },
    },
  });
  const snapshot = makeSnapshot("rev_platform" as RevisionId, []);
  const capabilities = createImportCapabilities({} as never, snapshot, { history: probe });

  expect(capabilities.history).toBe(probe);
  await expect(capabilities.history?.evaluateHistoryProbe({ actions: {} })).resolves.toEqual({
    steps: [],
  });
});

// Probe evaluation rebuilds the prefix in a fresh isolated session, so it is a
// pure function of the prepared-action payload. Review probes the same prefix
// many times, and the largest captures cannot afford redundant kernel rebuilds.
test("memoized history probe evaluates each distinct action payload exactly once", async () => {
  let evaluations = 0;
  const memoized = createMemoizedHistoryProbe({
    async evaluateHistoryProbe(input) {
      evaluations += 1;
      return {
        steps: (input.actions.orderedActions ?? []).map(() => ({
          status: "rebuilt" as const,
          signatures: [],
        })),
      };
    },
  });

  const prefix: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }] as never,
    orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
  };
  const first = await memoized.evaluateHistoryProbe({
    actions: prefix,
    consumerFeatureId: "consumer-a",
  });
  const second = await memoized.evaluateHistoryProbe({
    actions: prefix,
    consumerFeatureId: "consumer-b",
  });
  expect(second).toEqual(first);
  expect(evaluations).toBe(1);

  // A changed plan is a changed payload and must miss the cache.
  await memoized.evaluateHistoryProbe({ actions: { ...prefix, commitSketches: [] } });
  expect(evaluations).toBe(2);
  // The whole-plan verification pass asks for tessellation; that is a different
  // request and must not be answered from the prefix entry.
  await memoized.evaluateHistoryProbe({ actions: prefix, includeFinalTessellation: true });
  expect(evaluations).toBe(3);

  // Signature selection and rematch containment both affect observable probe
  // output, so neither request may reuse a legacy cache entry.
  await memoized.evaluateHistoryProbe({
    actions: prefix,
    requestedSignatureStepOrdinals: [],
  });
  await memoized.evaluateHistoryProbe({
    actions: prefix,
    requestedSignatureStepOrdinals: [],
  });
  expect(evaluations).toBe(4);
  await memoized.evaluateHistoryProbe({
    actions: prefix,
    containTopologyRematchFailures: true,
  });
  expect(evaluations).toBe(5);
});

// A failed probe is the input to review's containment pass, which exists to change
// the conditions the probe failed under. Until that pass runs, re-evaluating the
// identical payload can only reproduce the identical failure at full kernel cost,
// and 9841 probes one unbuildable prefix from every downstream consumer inside a
// single pass. Once containment has run, the retained failure is released.
test("memoized history probe retains a failed evaluation until containment forgets it", async () => {
  let evaluations = 0;
  const failedResult = {
    steps: [{
      status: "failed" as const,
      diagnostics: [{
        severity: "error" as const,
        code: "kernel-history-probe-step-failed",
        message: "A prefix feature the kernel refuses.",
      }],
    }],
  };
  const memoized = createMemoizedHistoryProbe({
    async evaluateHistoryProbe() {
      evaluations += 1;
      return failedResult;
    },
  });
  const actions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }] as never,
    orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
  };

  expect((await memoized.evaluateHistoryProbe({ actions })).steps[0]?.status).toBe("failed");
  expect((await memoized.evaluateHistoryProbe({ actions })).steps[0]?.status).toBe("failed");
  await memoized.evaluateHistoryProbe({ actions });
  expect(evaluations).toBe(1);

  // A changed action prefix is evaluated on its own.
  await memoized.evaluateHistoryProbe({
    actions: {
      addDocumentVariables: [{ name: "b" }] as never,
      orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
    },
  });
  expect(evaluations).toBe(2);

  // Containment ran: the prefix it contained must be able to reach the kernel
  // again even when the contained plan reproduces the same payload.
  memoized.forgetFailedEvaluations();
  await memoized.evaluateHistoryProbe({ actions });
  expect(evaluations).toBe(3);
});

// Lane: logic. Seam: an exact failed action prefix answers longer downstream
// probes until containment invalidates that evidence.
test("memoized history probe reuses an exact failed prefix for longer action sequences", async () => {
  let evaluations = 0;
  const memoized = createMemoizedHistoryProbe({
    async evaluateHistoryProbe() {
      evaluations += 1;
      return {
        steps: [
          { status: "rebuilt" as const, signatures: [] },
          {
            status: "failed" as const,
            diagnostics: [{
              severity: "error" as const,
              code: "kernel-history-probe-step-failed",
              message: "The second action fails.",
            }],
          },
        ],
      };
    },
  });
  const failedActions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }, { name: "b" }] as never,
    orderedActions: [
      { kind: "addDocumentVariable", index: 0 },
      { kind: "addDocumentVariable", index: 1 },
    ],
  };
  const longerActions: ImportPreparedActions = {
    addDocumentVariables: [{ name: "a" }, { name: "b" }, { name: "c" }] as never,
    orderedActions: [
      { kind: "addDocumentVariable", index: 0 },
      { kind: "addDocumentVariable", index: 1 },
      { kind: "addDocumentVariable", index: 2 },
    ],
  };

  const failed = await memoized.evaluateHistoryProbe({
    actions: failedActions,
    requestedSignatureStepOrdinals: [1],
  });
  const reused = await memoized.evaluateHistoryProbe({
    actions: longerActions,
    requestedSignatureStepOrdinals: [2],
  });
  expect(reused).toEqual(failed);
  expect(evaluations).toBe(1);

  memoized.forgetFailedEvaluations();
  await memoized.evaluateHistoryProbe({
    actions: longerActions,
    requestedSignatureStepOrdinals: [2],
  });
  expect(evaluations).toBe(2);
});

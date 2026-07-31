import type { OnshapeRollbackSnapshot } from "@/contracts/import/onshape-capture-bundle";

export type RollbackTopologyDiagnosticCode =
  | "rollback-tessellation-unreadable"
  | "rollback-feature-order-unreadable";

export interface RollbackTopologyDiagnostic {
  code: RollbackTopologyDiagnosticCode;
  message: string;
  featureId?: string;
}

export interface RollbackFacet {
  vertices: readonly [number, number, number][];
}

export interface RollbackFaceTopology {
  id: string;
  facets: readonly RollbackFacet[];
}

export interface RollbackBodyTopology {
  id: string;
  faces: readonly RollbackFaceTopology[];
}

export interface RollbackTopologySnapshot {
  featureId: string;
  tessellationTolerance: number;
  bodies: readonly RollbackBodyTopology[];
  diagnostics: readonly RollbackTopologyDiagnostic[];
  source: OnshapeRollbackSnapshot;
}

export interface RollbackBodyDelta {
  beforeFeatureId: string;
  afterFeatureId: string;
  introducedBodyDeterministicIds: readonly string[];
  changedBodyDeterministicIds: readonly string[];
  removedBodyDeterministicIds: readonly string[];
  unchangedBodyDeterministicIds: readonly string[];
}

export interface RollbackTopologyTimeline {
  readonly diagnostics: readonly RollbackTopologyDiagnostic[];
  snapshotBeforeFeature(featureId: string): RollbackTopologySnapshot | null;
  snapshotAfterFeature(featureId: string): RollbackTopologySnapshot | null;
  /**
   * Compare the nearest available snapshot before `fromFeatureId` with the
   * exact post-feature snapshot at `toFeatureId`. Returns null when either
   * required boundary is unavailable.
   */
  bodyDeltaBetweenFeatures(
    fromFeatureId: string,
    toFeatureId: string,
  ): RollbackBodyDelta | null;
  /**
   * Features strictly before `beforeFeatureId` whose post-feature snapshot
   * introduced the body or changed its topology/tessellation relative to the
   * previous snapshot. Attributes a consumed body to every history segment
   * that shaped it.
   */
  featuresModifyingBody(
    bodyDeterministicId: string,
    beforeFeatureId: string,
  ): readonly string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readPoint(value: unknown): [number, number, number] | null {
  const point = record(value);
  return point &&
    typeof point.x === "number" &&
    typeof point.y === "number" &&
    typeof point.z === "number"
    ? [point.x, point.y, point.z]
    : null;
}

/** Read only body/face IDs and facet vertices. Surplus Onshape fields are ignored. */
export function readRollbackTopologySnapshot(
  snapshot: OnshapeRollbackSnapshot,
): RollbackTopologySnapshot {
  const diagnostics: RollbackTopologyDiagnostic[] = [];
  const payload = record(snapshot.tessellatedFaces);
  if (!payload || !Array.isArray(payload.bodies)) {
    diagnostics.push({
      code: "rollback-tessellation-unreadable",
      featureId: snapshot.featureId,
      message: `Rollback snapshot ${snapshot.featureId} has no readable tessellation bodies.`,
    });
    return { ...snapshot, bodies: [], diagnostics, source: snapshot };
  }

  const bodies: RollbackBodyTopology[] = [];
  for (const rawBody of payload.bodies) {
    const body = record(rawBody);
    if (!body || typeof body.id !== "string" || !Array.isArray(body.faces)) {
      diagnostics.push({
        code: "rollback-tessellation-unreadable",
        featureId: snapshot.featureId,
        message: `Rollback snapshot ${snapshot.featureId} contains a malformed body.`,
      });
      continue;
    }
    const faces: RollbackFaceTopology[] = [];
    for (const rawFace of body.faces) {
      const face = record(rawFace);
      if (!face || typeof face.id !== "string" || !Array.isArray(face.facets)) {
        diagnostics.push({
          code: "rollback-tessellation-unreadable",
          featureId: snapshot.featureId,
          message: `Rollback body ${body.id} contains a malformed face.`,
        });
        continue;
      }
      const facets: RollbackFacet[] = [];
      for (const rawFacet of face.facets) {
        const facet = record(rawFacet);
        if (!facet || !Array.isArray(facet.vertices)) {
          diagnostics.push({
            code: "rollback-tessellation-unreadable",
            featureId: snapshot.featureId,
            message: `Rollback face ${face.id} contains a malformed facet.`,
          });
          continue;
        }
        const vertices = facet.vertices.map(readPoint);
        if (vertices.some((point) => point === null)) {
          diagnostics.push({
            code: "rollback-tessellation-unreadable",
            featureId: snapshot.featureId,
            message: `Rollback face ${face.id} contains a malformed facet vertex.`,
          });
          continue;
        }
        facets.push({ vertices: vertices as [number, number, number][] });
      }
      faces.push({ id: face.id, facets });
    }
    bodies.push({ id: body.id, faces });
  }

  return { ...snapshot, bodies, diagnostics, source: snapshot };
}

const rollbackBodyShapeKeys = new WeakMap<RollbackBodyTopology, string>();

/** Exact parsed tessellation key. Source payload surplus and STEP order are excluded. */
export function rollbackBodyShapeKey(body: RollbackBodyTopology): string {
  const cached = rollbackBodyShapeKeys.get(body);
  if (cached !== undefined) return cached;
  const key = JSON.stringify(body.faces);
  rollbackBodyShapeKeys.set(body, key);
  return key;
}

/** Compare complete before/after body states by deterministic ID and exact shape key. */
export function diffRollbackTopologySnapshots(
  before: RollbackTopologySnapshot,
  after: RollbackTopologySnapshot,
): RollbackBodyDelta {
  const beforeBodies = new Map(before.bodies.map((body) => [body.id, body]));
  const afterBodies = new Map(after.bodies.map((body) => [body.id, body]));
  const introducedBodyDeterministicIds: string[] = [];
  const changedBodyDeterministicIds: string[] = [];
  const removedBodyDeterministicIds: string[] = [];
  const unchangedBodyDeterministicIds: string[] = [];

  for (const [id, body] of afterBodies) {
    const previous = beforeBodies.get(id);
    if (!previous) introducedBodyDeterministicIds.push(id);
    else if (rollbackBodyShapeKey(previous) === rollbackBodyShapeKey(body)) {
      unchangedBodyDeterministicIds.push(id);
    } else changedBodyDeterministicIds.push(id);
  }
  for (const id of beforeBodies.keys()) {
    if (!afterBodies.has(id)) removedBodyDeterministicIds.push(id);
  }

  introducedBodyDeterministicIds.sort();
  changedBodyDeterministicIds.sort();
  removedBodyDeterministicIds.sort();
  unchangedBodyDeterministicIds.sort();
  return {
    beforeFeatureId: before.featureId,
    afterFeatureId: after.featureId,
    introducedBodyDeterministicIds,
    changedBodyDeterministicIds,
    removedBodyDeterministicIds,
    unchangedBodyDeterministicIds,
  };
}

const rollbackTimelineCache = new WeakMap<
  readonly OnshapeRollbackSnapshot[],
  Map<string, RollbackTopologyTimeline>
>();

/** Build feature-order lookup. STEP text is intentionally never inspected for identity. */
export function createRollbackTopologyTimeline(input: {
  featureIds: readonly string[];
  snapshots: readonly OnshapeRollbackSnapshot[] | null;
}): RollbackTopologyTimeline {
  const featureOrderKey = input.featureIds.join("\u0000");
  const cached = input.snapshots
    ? rollbackTimelineCache.get(input.snapshots)?.get(featureOrderKey)
    : undefined;
  if (cached) return cached;

  const diagnostics: RollbackTopologyDiagnostic[] = [];
  const featureIndex = new Map(input.featureIds.map((id, index) => [id, index]));
  const snapshots = new Map<string, RollbackTopologySnapshot>();
  const bodyDeltaCache = new Map<string, RollbackBodyDelta | null>();
  const bodyModifierCache = new Map<string, readonly string[]>();
  for (const snapshot of input.snapshots ?? []) {
    if (!featureIndex.has(snapshot.featureId)) {
      diagnostics.push({
        code: "rollback-feature-order-unreadable",
        featureId: snapshot.featureId,
        message: `Rollback snapshot ${snapshot.featureId} is not present in feature-list order.`,
      });
      continue;
    }
    snapshots.set(snapshot.featureId, readRollbackTopologySnapshot(snapshot));
  }

  const timeline: RollbackTopologyTimeline = {
    diagnostics,
    snapshotAfterFeature(featureId) {
      return snapshots.get(featureId) ?? null;
    },
    snapshotBeforeFeature(featureId) {
      const consumerIndex = featureIndex.get(featureId);
      if (consumerIndex === undefined) return null;
      for (let index = consumerIndex - 1; index >= 0; index -= 1) {
        const snapshot = snapshots.get(input.featureIds[index]!);
        if (snapshot) return snapshot;
      }
      return null;
    },
    bodyDeltaBetweenFeatures(fromFeatureId, toFeatureId) {
      const key = JSON.stringify([fromFeatureId, toFeatureId]);
      if (bodyDeltaCache.has(key)) return bodyDeltaCache.get(key) ?? null;
      const before = this.snapshotBeforeFeature(fromFeatureId);
      const after = this.snapshotAfterFeature(toFeatureId);
      const delta = before &&
          before.diagnostics.length === 0 &&
          after &&
          after.diagnostics.length === 0
        ? diffRollbackTopologySnapshots(before, after)
        : null;
      bodyDeltaCache.set(key, delta);
      return delta;
    },
    featuresModifyingBody(bodyDeterministicId, beforeFeatureId) {
      const key = JSON.stringify([bodyDeterministicId, beforeFeatureId]);
      const cachedModifiers = bodyModifierCache.get(key);
      if (cachedModifiers) return cachedModifiers;
      const limit = featureIndex.get(beforeFeatureId) ?? input.featureIds.length;
      const modifiers: string[] = [];
      let previousShape: string | null = null;
      for (let index = 0; index < limit; index += 1) {
        const snapshot = snapshots.get(input.featureIds[index]!);
        if (!snapshot) continue;
        const body = snapshot.bodies.find(
          (candidate) => candidate.id === bodyDeterministicId,
        );
        const shape = body ? rollbackBodyShapeKey(body) : null;
        if (shape !== previousShape) modifiers.push(snapshot.featureId);
        previousShape = shape;
      }
      bodyModifierCache.set(key, modifiers);
      return modifiers;
    },
  };

  if (input.snapshots) {
    const timelines = rollbackTimelineCache.get(input.snapshots) ?? new Map();
    timelines.set(featureOrderKey, timeline);
    rollbackTimelineCache.set(input.snapshots, timelines);
  }
  return timeline;
}

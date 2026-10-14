import { getPrimitiveRefKey, getPrimitiveRefLabel } from "@/core/editor/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  WorkspaceSnapshot,
  FeatureSnapshotRecord,
  SnapshotEntityRecord,
} from "@/contracts/modeling/schema";
import type { FeatureId } from "@/contracts/shared/ids";
import type { SelectionTargetCatalog } from "@/core/editor/schema";

export interface DocumentSelectionDetail {
  label: string;
  kindLabel: string;
  ownerLabel: string;
  relatedLabels: string[];
}

function getFeatureLabel(
  snapshot: WorkspaceSnapshot,
  featureId: DocumentSelectionDetail["label"],
) {
  return (
    snapshot.document.features.find(
      (feature) => feature.featureId === featureId,
    )?.label ?? null
  );
}

function getSketchLabel(
  snapshot: WorkspaceSnapshot,
  sketchId: DocumentSelectionDetail["label"],
) {
  return (
    snapshot.document.sketches.find((sketch) => sketch.sketchId === sketchId)
      ?.label ?? null
  );
}

function getBodyLabel(
  snapshot: WorkspaceSnapshot,
  bodyId: DocumentSelectionDetail["label"],
) {
  return (
    snapshot.document.bodies.find((body) => body.bodyId === bodyId)?.label ??
    null
  );
}

export function getEntityRecordForTarget(
  snapshot: WorkspaceSnapshot,
  target: PrimitiveRef,
) {
  const targetKey = getPrimitiveRefKey(target);
  return (
    snapshot.presentation.entities.find(
      (entity) => getPrimitiveRefKey(entity.target) === targetKey,
    ) ?? null
  );
}

export function getTargetContributingFeatureIds(
  snapshot: WorkspaceSnapshot,
  target: PrimitiveRef | null,
): FeatureId[] {
  if (!target) {
    return [];
  }

  return [
    ...(getEntityRecordForTarget(snapshot, target)?.contributingFeatureIds ??
      []),
  ];
}

function getOwnerLabel(
  snapshot: WorkspaceSnapshot,
  entity: SnapshotEntityRecord,
) {
  if (entity.ownerFeatureId) {
    return (
      getFeatureLabel(snapshot, entity.ownerFeatureId) ?? entity.ownerFeatureId
    );
  }

  if (entity.ownerSketchId) {
    return (
      getSketchLabel(snapshot, entity.ownerSketchId) ?? entity.ownerSketchId
    );
  }

  if (entity.ownerBodyId) {
    return getBodyLabel(snapshot, entity.ownerBodyId) ?? entity.ownerBodyId;
  }

  return "Document root";
}

export function getSelectionDetail(
  snapshot: WorkspaceSnapshot,
  target: PrimitiveRef,
): DocumentSelectionDetail {
  const entity = getEntityRecordForTarget(snapshot, target);

  if (!entity) {
    return {
      label: getPrimitiveRefLabel(target),
      kindLabel: target.kind,
      ownerLabel: "Unresolved selection",
      relatedLabels: [],
    };
  }

  return {
    label: entity.label,
    kindLabel: entity.target.kind,
    ownerLabel: getOwnerLabel(snapshot, entity),
    relatedLabels: entity.relatedTargets.map((relatedTarget) => {
      const relatedEntity = getEntityRecordForTarget(snapshot, relatedTarget);

      if (!relatedEntity) {
        throw new Error(
          `Related target ${getPrimitiveRefKey(relatedTarget)} is missing from snapshot.presentation.entities.`,
        );
      }

      return relatedEntity.label;
    }),
  };
}

export function getFeatureSnapshot(
  snapshot: WorkspaceSnapshot,
  featureId: FeatureSnapshotRecord["featureId"],
) {
  return (
    snapshot.document.features.find(
      (feature) => feature.featureId === featureId,
    ) ?? null
  );
}

export function buildSelectionTargetCatalog(
  snapshot: WorkspaceSnapshot,
): SelectionTargetCatalog {
  const entries = snapshot.presentation.entities.map((entity) => ({
    key: getPrimitiveRefKey(entity.target),
    semantics: entity.selectionSemantics,
  }));

  return {
    selectableTargetKeys: entries.map((entry) => entry.key),
    existingSketchKeys: entries
      .filter((entry) => entry.semantics.includes("existingSketch"))
      .map((entry) => entry.key),
    constructionPlaneKeys: entries
      .filter((entry) => entry.semantics.includes("constructionPlane"))
      .map((entry) => entry.key),
    planarFaceKeys: entries
      .filter((entry) => entry.semantics.includes("planarFace"))
      .map((entry) => entry.key),
  };
}

/**
 * T17k2 (T17e review A-2 routed): the name a reference chip shows for
 * `target`, never its id: a region as "‹sketch›: ‹region›", a record by its
 * label, any other target by its presentation entity's label. Null when
 * the snapshot does not hold it (a region: it no longer exists).
 */
export function getReferenceTargetLabel(
  snapshot: WorkspaceSnapshot | null | undefined,
  target: PrimitiveRef,
): string | null {
  if (!snapshot) return null;
  if (target.kind === "region") {
    const sketch = snapshot.document.sketches.find(
      (entry) => entry.sketchId === target.sketchId,
    );
    const region = sketch?.sketch.regions.find(
      (entry) => entry.regionId === target.regionId,
    );
    return sketch && region ? `${sketch.label}: ${region.label}` : null;
  }
  if (target.kind === "sketch")
    return getSketchLabel(snapshot, target.sketchId);
  if (target.kind === "feature")
    return getFeatureLabel(snapshot, target.featureId);
  if (target.kind === "body") return getBodyLabel(snapshot, target.bodyId);
  return getEntityRecordForTarget(snapshot, target)?.label ?? null;
}

/** The sketch label of a region that no longer exists, if its sketch does. */
export function getMissingRegionSketchLabel(
  snapshot: WorkspaceSnapshot | null | undefined,
  target: Extract<PrimitiveRef, { kind: "region" }>,
) {
  return snapshot ? getSketchLabel(snapshot, target.sketchId) : null;
}

import type {
  DocumentFeatureCursor,
  DocumentVariableRecord,
  FeatureDefinition,
  KernelDocumentSnapshot,
  SketchSnapshotRecord,
  WorkspaceSnapshot,
} from '@/contracts/modeling/schema'
import type { BodyId, DocumentId, FeatureId, RevisionId, SketchId } from '@/contracts/shared/ids'
import type { GeometryAssetManifest } from '@/contracts/modeling/geometry-assets'
import { createEmptyGeometryAssetManifest } from '@/contracts/modeling/geometry-assets'
import type { EmbeddedBinaryAssetRecord } from '@/contracts/modeling/embedded-binary-assets'
import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  CONTRACT_VERSION,
  type AuthoredModelDocumentSchemaVersion,
  type ContractVersion,
} from '@/contracts/shared/versioning'

export interface AuthoredSketchRecord {
  sketchId: SketchId
  label: string
  plane: SketchSnapshotRecord['plane']
  definition: SketchSnapshotRecord['sketch']['definition']
}

export interface AuthoredFeatureRecord {
  featureId: FeatureId
  label: string
  definition: FeatureDefinition
}

export interface AuthoredBodyLabelRecord {
  bodyId: BodyId
  label: string
}

export type AuthoredDocumentHistoryOrderEntry =
  | { kind: 'sketch'; sketchId: SketchId }
  | { kind: 'feature'; featureId: FeatureId }

export interface AuthoredModelDocument {
  contractVersion: ContractVersion
  schemaVersion: AuthoredModelDocumentSchemaVersion
  documentId: DocumentId
  revisionId: RevisionId
  settings: KernelDocumentSnapshot['settings']
  variables: DocumentVariableRecord[]
  sketches: AuthoredSketchRecord[]
  features: AuthoredFeatureRecord[]
  featureOrder: FeatureId[]
  historyOrder: AuthoredDocumentHistoryOrderEntry[]
  cursor: DocumentFeatureCursor
  bodyLabels: AuthoredBodyLabelRecord[]
  assets: GeometryAssetManifest
  embeddedBinaryAssets: EmbeddedBinaryAssetRecord[]
}

export interface AuthoredModelDocumentDiagnostic {
  reasonCode: string
  message: string
}

export type AuthoredModelDocumentMigrationResult =
  | { ok: true; document: AuthoredModelDocument; migrated: boolean }
  | { ok: false; diagnostic: AuthoredModelDocumentDiagnostic }

export function createAuthoredModelDocumentFromSnapshot(snapshot: WorkspaceSnapshot): AuthoredModelDocument {
  return {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
    settings: structuredClone(snapshot.document.settings),
    variables: structuredClone(snapshot.document.variables),
    sketches: snapshot.document.sketches.map((sketch) => ({
      sketchId: sketch.sketchId,
      label: sketch.label,
      plane: structuredClone(sketch.plane),
      definition: structuredClone(sketch.sketch.definition),
    })),
    features: snapshot.document.features.map((feature) => ({
      featureId: feature.featureId,
      label: feature.label,
      definition: structuredClone(feature.definition),
    })),
    featureOrder: snapshot.document.features.map((feature) => feature.featureId),
    historyOrder: snapshot.presentation.documentHistory.map((item) =>
      item.kind === 'sketch'
        ? { kind: 'sketch' as const, sketchId: item.sketchId }
        : { kind: 'feature' as const, featureId: item.featureId },
    ),
    cursor: structuredClone(snapshot.document.cursor),
    bodyLabels: snapshot.document.bodies.map((body) => ({
      bodyId: body.bodyId,
      label: body.label,
    })),
    assets: createEmptyGeometryAssetManifest(),
    embeddedBinaryAssets: [],
  }
}

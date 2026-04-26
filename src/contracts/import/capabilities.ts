import type { CommitSketchRequest } from '@/contracts/modeling/schema'
import type {
  GeometryAssetFormat,
  GeometryAssetProvenance,
} from '@/contracts/modeling/geometry-assets'
import type { GeometryAssetId } from '@/contracts/shared/ids'
import type { ContractVersion } from '@/contracts/shared/versioning'
import type { DocumentId, RevisionId } from '@/contracts/shared/ids'

/**
 * TODO: replace `unknown` with a shared neutral vector primitive union once
 * provider-side vector parsing contracts are introduced.
 */
export type VectorPrimitive = unknown

/**
 * 2D affine transform encoded as [a, b, c, d, tx, ty].
 */
export type AffineTransform2d = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
]

export interface ImportModelingCapabilities {
  /**
   * Bakes external geometry into a Cadara-owned geometry asset for downstream
   * feature creation without providers importing kernel internals directly.
   */
  bakeGeometry(input: {
    bytes: Uint8Array
    format: GeometryAssetFormat
    options?: Record<string, unknown>
  }): Promise<GeometryAssetId>

  /**
   * Reconstructs mesh-backed geometry into a native B-rep asset when a
   * provider wants editable solids instead of faceted-only output.
   */
  reconstructMeshToBrep(input: {
    assetId: GeometryAssetId
    options?: Record<string, unknown>
  }): Promise<GeometryAssetId>
}

export interface ImportSketchCapabilities {
  /**
   * Converts provider-parsed vector primitives into committed sketch entity
   * data suitable for `CommitSketchRequest` payloads.
   */
  convertVectorToSketch(input: {
    primitives: readonly VectorPrimitive[]
    transform?: AffineTransform2d
  }): Promise<CommitSketchRequest['definition']>
}

export interface ImportAssetCapabilities {
  /**
   * Registers immutable geometry bytes for use in provider-prepared feature definitions.
   */
  registerGeometryAsset(input: {
    bytes: Uint8Array
    format: GeometryAssetFormat
    mediaType: string
    provenance: GeometryAssetProvenance
  }): Promise<GeometryAssetId>

  /**
   * Stores embedded binary content outside authored feature payloads and
   * returns a durable asset handle for later lookup.
   */
  storeEmbeddedBinary(input: {
    bytes: Uint8Array
    mediaType: string
    fileName?: string
  }): Promise<string>
}

export interface ImportMutationContextCapabilities {
  contractVersion: ContractVersion
  documentId: DocumentId
  baseRevisionId: RevisionId
}

export interface ImportCapabilities {
  context: ImportMutationContextCapabilities
  modeling: ImportModelingCapabilities
  sketch: ImportSketchCapabilities
  assets: ImportAssetCapabilities
}

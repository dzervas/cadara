import type { ImportBinding } from '@/contracts/import/binding'
import type { ImportPreparedActions } from '@/contracts/import/actions'
import type { ImportProvider } from '@/contracts/import/provider'
import type { ImportReviewEnvelope } from '@/contracts/import/review'
import type { ResolvedImportSource } from '@/contracts/import/source'
import type { ImportCapabilities } from '@/contracts/import/capabilities'
import type { CommitSketchRequest, SketchPoint } from '@/contracts/modeling/schema'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import { SKETCH_SCHEMA_VERSION } from '@/contracts/sketch/schema'
import type {
  SketchPlaneDefinition,
  SketchPlaneKey,
  SketchPlaneSupportRef,
} from '@/contracts/shared/sketch-plane'
import { CONTRACT_VERSION, IMPORT_CONTRACT_SCHEMA_VERSION } from '@/contracts/shared/versioning'

const DEFAULT_IMAGE_EXTENT = 200
const IMAGE_ENTITY_ID = 'sketch_entity_image_reference'
const IMAGE_POINT_IDS = [
  'sketch_point_image_reference_tl',
  'sketch_point_image_reference_tr',
  'sketch_point_image_reference_br',
  'sketch_point_image_reference_bl',
] as const
const IMAGE_CONSTRAINT_IDS = [
  'constraint_image_reference_tl',
  'constraint_image_reference_tr',
  'constraint_image_reference_br',
  'constraint_image_reference_bl',
] as const
const IMAGE_UV_WINDING = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
] as const

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'])
const SUPPORTED_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/x-ms-bmp',
  'image/tiff',
])

export interface ImageImportReview {
  pixelWidth: number
  pixelHeight: number
  sourceName: string
}

export interface ImageImportSelections {
  plane: SketchPlaneDefinition
  planeTarget: SketchPlaneSupportRef
  planeKey: SketchPlaneKey | null
}

export class ImageImportProvider implements ImportProvider<ImageImportReview, ImageImportSelections> {
  readonly id = 'imageReference'
  readonly label = 'Image Reference'

  accepts(source: ResolvedImportSource) {
    const extension = getFileExtension(source.name)
    const mediaType = source.mediaType?.toLowerCase() ?? null

    return (extension !== null && SUPPORTED_EXTENSIONS.has(extension))
      || (mediaType !== null && SUPPORTED_MEDIA_TYPES.has(mediaType))
  }

  async review(input: {
    source: ResolvedImportSource
    capabilities: ImportCapabilities
  }): Promise<ImportReviewEnvelope<ImageImportReview>> {
    try {
      const { width, height } = readRasterImageDimensions(input.source.bytes)

      return {
        providerReview: {
          pixelWidth: width,
          pixelHeight: height,
          sourceName: input.source.name,
        },
        proposedActionKinds: ['commitSketch'],
        diagnostics: [],
      }
    } catch (error) {
      return {
        providerReview: {
          pixelWidth: 0,
          pixelHeight: 0,
          sourceName: input.source.name,
        },
        proposedActionKinds: ['commitSketch'],
        diagnostics: [{
          severity: 'error',
          code: 'image-decode-failed',
          message: error instanceof Error
            ? error.message
            : 'Could not decode the imported image.',
        }],
      }
    }
  }

  async prepare(input: {
    source: ResolvedImportSource
    review: ImportReviewEnvelope<ImageImportReview>
    selections: ImageImportSelections
    capabilities: ImportCapabilities
  }): Promise<ImportPreparedActions> {
    if (input.review.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return { diagnostics: [...input.review.diagnostics] }
    }

    const embeddedBinaryId = await input.capabilities.assets.storeEmbeddedBinary({
      bytes: input.source.bytes,
      mediaType: input.source.mediaType ?? inferMediaTypeFromName(input.source.name) ?? 'application/octet-stream',
      fileName: input.source.origin.kind === 'localFile' ? input.source.origin.fileName : input.source.name,
    })

    const review = input.review.providerReview
    const definition = createImageReferenceSketchDefinition({
      sketchId: 'sketch_image_reference_import',
      embeddedBinaryId,
      pixelWidth: review.pixelWidth,
      pixelHeight: review.pixelHeight,
    })

    return {
      commitSketches: [createCommitSketchRequest({
        capabilities: input.capabilities,
        selections: input.selections,
        sketchLabel: deriveSketchLabel(review.sourceName),
        definition,
      })],
      binding: createImportBinding(input.source),
      diagnostics: [],
    }
  }
}

export function createImageImportProvider() {
  return new ImageImportProvider()
}

function createCommitSketchRequest(input: {
  capabilities: ImportCapabilities
  selections: ImageImportSelections
  sketchLabel: string
  definition: SketchDefinition
}): CommitSketchRequest {
  return {
    contractVersion: input.capabilities.context.contractVersion,
    documentId: input.capabilities.context.documentId,
    baseRevisionId: input.capabilities.context.baseRevisionId,
    solverCorrelation: null,
    sketchId: null,
    sketchLabel: input.sketchLabel,
    plane: input.selections.plane,
    planeTarget: input.selections.planeTarget,
    planeKey: input.selections.planeKey,
    definition: input.definition,
  }
}

function createImageReferenceSketchDefinition(input: {
  sketchId: CommitSketchRequest['definition']['points'][number]['target']['sketchId']
  embeddedBinaryId: string
  pixelWidth: number
  pixelHeight: number
}): SketchDefinition {
  const corners = createInitialCornerPositions(input.pixelWidth, input.pixelHeight)
  const pointTargets = IMAGE_POINT_IDS.map((pointId) => ({
    kind: 'sketchPoint' as const,
    sketchId: input.sketchId,
    pointId,
  }))

  return {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: [...IMAGE_POINT_IDS],
    points: IMAGE_POINT_IDS.map((pointId, index) => ({
      pointId,
      label: `Image corner ${index + 1}`,
      target: pointTargets[index]!,
      position: corners[index]!,
      isConstruction: true,
    })),
    entityIds: [IMAGE_ENTITY_ID],
    entities: [{
      kind: 'imageReference',
      entityId: IMAGE_ENTITY_ID,
      label: 'Image reference',
      target: {
        kind: 'sketchEntity',
        sketchId: input.sketchId,
        entityId: IMAGE_ENTITY_ID,
      },
      isConstruction: true,
      cornerPointIds: [...IMAGE_POINT_IDS],
      embeddedBinaryId: input.embeddedBinaryId,
      pixelWidth: input.pixelWidth,
      pixelHeight: input.pixelHeight,
    }],
    constraintIds: [...IMAGE_CONSTRAINT_IDS],
    constraints: IMAGE_CONSTRAINT_IDS.map((constraintId, index) => ({
      constraintId,
      kind: 'fixPoint',
      label: `Fix image corner ${index + 1}`,
      pointId: IMAGE_POINT_IDS[index]!,
      position: corners[index]!,
    })),
    dimensionIds: [],
    dimensions: [],
    styleIds: [],
    styles: [],
    svgRenderingEnabled: true,
    derivedRelationships: [],
    authoringOperations: [],
  }
}

function createInitialCornerPositions(pixelWidth: number, pixelHeight: number): readonly [SketchPoint, SketchPoint, SketchPoint, SketchPoint] {
  const scale = DEFAULT_IMAGE_EXTENT / Math.max(pixelWidth, pixelHeight)
  const width = pixelWidth * scale
  const height = pixelHeight * scale
  const halfWidth = width / 2
  const halfHeight = height / 2

  return [
    [-halfWidth, halfHeight],
    [halfWidth, halfHeight],
    [halfWidth, -halfHeight],
    [-halfWidth, -halfHeight],
  ]
}

function createImportBinding(source: ResolvedImportSource): ImportBinding {
  switch (source.origin.kind) {
    case 'localFile':
      return {
        schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
        kind: 'localFile',
        fileName: source.origin.fileName,
        pathHint: source.origin.pathHint,
        fingerprint: source.fingerprint,
        refreshPolicy: 'manual',
      }
    case 'url':
      return {
        schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
        kind: 'url',
        url: source.origin.url,
        fingerprint: source.fingerprint,
        refreshPolicy: 'manual',
      }
    case 'cloudObject':
      return {
        schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
        kind: 'cloudObject',
        service: source.origin.service,
        objectId: source.origin.objectId,
        versionId: source.origin.versionId,
        fingerprint: source.fingerprint,
        refreshPolicy: 'manual',
      }
  }
}

function deriveSketchLabel(sourceName: string) {
  const trimmed = sourceName.trim()
  const withoutExtension = trimmed.replace(/\.[^.]+$/, '')
  return withoutExtension.length > 0 ? withoutExtension : trimmed.length > 0 ? trimmed : 'Image reference'
}

function getFileExtension(name: string) {
  const match = /\.([^.]+)$/.exec(name.trim())
  return match?.[1]?.toLowerCase() ?? null
}

function inferMediaTypeFromName(name: string) {
  const extension = getFileExtension(name)
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    default:
      return null
  }
}

export function readRasterImageDimensions(bytes: Uint8Array) {
  const png = readPngDimensions(bytes)
  if (png) {
    return png
  }

  const jpeg = readJpegDimensions(bytes)
  if (jpeg) {
    return jpeg
  }

  const webp = readWebpDimensions(bytes)
  if (webp) {
    return webp
  }

  const bmp = readBmpDimensions(bytes)
  if (bmp) {
    return bmp
  }

  const tiff = readTiffDimensions(bytes)
  if (tiff) {
    return tiff
  }

  throw new Error('Could not decode image dimensions from the imported bytes.')
}

function readPngDimensions(bytes: Uint8Array) {
  if (
    bytes.byteLength < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
  ) {
    return null
  }

  return {
    width: readUint32(bytes, 16, false),
    height: readUint32(bytes, 20, false),
  }
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = bytes[offset + 1]
    if (marker === undefined) {
      break
    }
    offset += 2

    while (bytes[offset] === 0xff) {
      offset += 1
    }

    if (marker === 0xd9 || marker === 0xda) {
      break
    }

    const segmentLength = readUint16(bytes, offset, false)
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      break
    }

    if (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        width: readUint16(bytes, offset + 5, false),
        height: readUint16(bytes, offset + 3, false),
      }
    }

    offset += segmentLength
  }

  return null
}

function readWebpDimensions(bytes: Uint8Array) {
  if (
    bytes.byteLength < 16
    || readAscii(bytes, 0, 4) !== 'RIFF'
    || readAscii(bytes, 8, 4) !== 'WEBP'
  ) {
    return null
  }

  const chunkType = readAscii(bytes, 12, 4)
  if (chunkType === 'VP8X' && bytes.byteLength >= 30) {
    return {
      width: 1 + readUint24(bytes, 24, true),
      height: 1 + readUint24(bytes, 27, true),
    }
  }

  if (chunkType === 'VP8L' && bytes.byteLength >= 25) {
    const bits = readUint32(bytes, 21, true)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }

  if (chunkType === 'VP8 ' && bytes.byteLength >= 30) {
    return {
      width: readUint16(bytes, 26, true) & 0x3fff,
      height: readUint16(bytes, 28, true) & 0x3fff,
    }
  }

  return null
}

function readBmpDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return null
  }

  return {
    width: Math.abs(readInt32(bytes, 18, true)),
    height: Math.abs(readInt32(bytes, 22, true)),
  }
}

function readTiffDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 8) {
    return null
  }

  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d
  if (!littleEndian && !bigEndian) {
    return null
  }

  const little = littleEndian
  const magic = readUint16(bytes, 2, little)
  if (magic !== 42) {
    return null
  }

  const ifdOffset = readUint32(bytes, 4, little)
  if (ifdOffset + 2 > bytes.byteLength) {
    return null
  }

  const entryCount = readUint16(bytes, ifdOffset, little)
  let width: number | null = null
  let height: number | null = null

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12
    if (entryOffset + 12 > bytes.byteLength) {
      break
    }

    const tag = readUint16(bytes, entryOffset, little)
    const type = readUint16(bytes, entryOffset + 2, little)
    const count = readUint32(bytes, entryOffset + 4, little)
    const valueOffset = entryOffset + 8
    const value = readTiffValue(bytes, valueOffset, type, count, little)

    if (tag === 256 && typeof value === 'number') {
      width = value
    }
    if (tag === 257 && typeof value === 'number') {
      height = value
    }
  }

  return width !== null && height !== null ? { width, height } : null
}

function readTiffValue(
  bytes: Uint8Array,
  valueOffset: number,
  type: number,
  count: number,
  littleEndian: boolean,
) {
  if (count !== 1) {
    return null
  }

  if (type === 3) {
    return readUint16(bytes, valueOffset, littleEndian)
  }

  if (type === 4) {
    return readUint32(bytes, valueOffset, littleEndian)
  }

  return null
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, littleEndian)
}

function readUint24(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  if (littleEndian) {
    return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  }

  return (bytes[offset]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset + 2]!
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, littleEndian)
}

function readInt32(bytes: Uint8Array, offset: number, littleEndian: boolean) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, littleEndian)
}

export const IMAGE_REFERENCE_UV_WINDING = IMAGE_UV_WINDING
export const IMAGE_IMPORT_DEFAULT_EXTENT = DEFAULT_IMAGE_EXTENT
export const IMAGE_IMPORT_CONTRACT_VERSION = CONTRACT_VERSION

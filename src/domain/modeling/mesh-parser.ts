import { unzipSync } from 'fflate'

import type { MeshImportSourceFormat } from '@/contracts/modeling/mesh-import'

export type MeshPoint = readonly [number, number, number]
export type MeshTriangle = readonly [MeshPoint, MeshPoint, MeshPoint]

export interface ParsedMeshSource {
  sourceFormat: MeshImportSourceFormat
  triangles: MeshTriangle[]
}

export class MeshParseError extends Error {
  readonly sourceFormat: MeshImportSourceFormat

  constructor(
    message: string,
    sourceFormat: MeshImportSourceFormat,
  ) {
    super(message)
    this.name = 'MeshParseError'
    this.sourceFormat = sourceFormat
  }
}

export function inferMeshSourceFormat(fileName: string): MeshImportSourceFormat | null {
  if (/\.stl$/i.test(fileName)) {
    return 'stl'
  }

  if (/\.3mf$/i.test(fileName)) {
    return '3mf'
  }

  return null
}

export function parseMeshSourceFile(input: { fileName: string; bytes: Uint8Array }): ParsedMeshSource {
  const sourceFormat = inferMeshSourceFormat(input.fileName)
  if (!sourceFormat) {
    throw new MeshParseError('Select an STL or 3MF file.', 'stl')
  }

  return sourceFormat === 'stl'
    ? { sourceFormat, triangles: parseStlTriangles(input.bytes) }
    : { sourceFormat, triangles: parse3mfTriangles(input.bytes) }
}

export function parseStlTriangles(bytes: Uint8Array): MeshTriangle[] {
  const triangles = isBinaryStl(bytes)
    ? parseBinaryStlTriangles(bytes)
    : parseAsciiStlTriangles(new TextDecoder().decode(bytes))

  if (triangles.length === 0) {
    throw new MeshParseError('STL file does not contain triangle facets.', 'stl')
  }

  return triangles
}

function isBinaryStl(bytes: Uint8Array) {
  if (bytes.byteLength < 84) {
    return false
  }

  const triangleCount = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
  return 84 + triangleCount * 50 === bytes.byteLength
}

function parseBinaryStlTriangles(bytes: Uint8Array): MeshTriangle[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangleCount = view.getUint32(80, true)
  const triangles: MeshTriangle[] = []

  for (let index = 0; index < triangleCount; index += 1) {
    const triangleOffset = 84 + index * 50
    triangles.push([
      readBinaryStlPoint(view, triangleOffset + 12),
      readBinaryStlPoint(view, triangleOffset + 24),
      readBinaryStlPoint(view, triangleOffset + 36),
    ])
  }

  return triangles
}

function readBinaryStlPoint(view: DataView, offset: number): MeshPoint {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ]
}

function parseAsciiStlTriangles(text: string): MeshTriangle[] {
  const triangles: MeshTriangle[] = []
  const facetPattern = /facet\s+normal\b[\s\S]*?endfacet/gi
  let facetMatch: RegExpExecArray | null

  while ((facetMatch = facetPattern.exec(text)) !== null) {
    const vertices = [...facetMatch[0].matchAll(/vertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi)]
      .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as MeshPoint)

    if (vertices.length !== 3) {
      throw new MeshParseError('ASCII STL facet does not contain exactly three vertices.', 'stl')
    }

    triangles.push([vertices[0]!, vertices[1]!, vertices[2]!])
  }

  return triangles
}

export function parse3mfTriangles(bytes: Uint8Array): MeshTriangle[] {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (error) {
    throw new MeshParseError(error instanceof Error ? error.message : '3MF ZIP container could not be read.', '3mf')
  }

  const modelEntryName = Object.keys(entries).find((name) => /^3D\/.+\.model$/i.test(name))
  const modelEntry = modelEntryName ? entries[modelEntryName] : undefined
  if (!modelEntry) {
    throw new MeshParseError('3MF package does not contain a 3D model part.', '3mf')
  }

  return parse3mfModelXml(new TextDecoder().decode(modelEntry))
}

function parse3mfModelXml(xml: string): MeshTriangle[] {
  if (/<components\b/i.test(xml)) {
    throw new MeshParseError('3MF component references are not supported by the triangle-only importer.', '3mf')
  }

  const objects = parse3mfObjects(xml)
  const buildObjectIds = [...xml.matchAll(/<item\b([^>]*)\/?>/gi)].map((match) => {
    const attrs = parseXmlAttributes(match[1]!)
    if (attrs.transform && !isIdentity3mfTransform(attrs.transform)) {
      throw new MeshParseError('3MF build transforms are not supported by the triangle-only importer.', '3mf')
    }
    return attrs.objectid
  }).filter((objectId): objectId is string => Boolean(objectId))
  const selectedObjectIds = buildObjectIds.length > 0 ? buildObjectIds : [...objects.keys()]
  const triangles = selectedObjectIds.flatMap((objectId) => objects.get(objectId) ?? [])

  if (triangles.length === 0) {
    throw new MeshParseError('3MF model does not contain triangle geometry.', '3mf')
  }

  return triangles
}

function parse3mfObjects(xml: string) {
  const objects = new Map<string, MeshTriangle[]>()
  const objectPattern = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi
  let objectMatch: RegExpExecArray | null

  while ((objectMatch = objectPattern.exec(xml)) !== null) {
    const objectAttrs = parseXmlAttributes(objectMatch[1]!)
    if (!objectAttrs.id) {
      continue
    }

    const body = objectMatch[2]!
    const vertices = [...body.matchAll(/<vertex\b([^/>]*)\/?>/gi)].map((match) => {
      const attrs = parseXmlAttributes(match[1]!)
      return [Number(attrs.x), Number(attrs.y), Number(attrs.z)] as MeshPoint
    })
    const triangles = [...body.matchAll(/<triangle\b([^/>]*)\/?>/gi)].map((match) => {
      const attrs = parseXmlAttributes(match[1]!)
      const indexes = [Number(attrs.v1), Number(attrs.v2), Number(attrs.v3)]
      if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices.length)) {
        throw new MeshParseError('3MF triangle references an invalid vertex index.', '3mf')
      }

      return [vertices[indexes[0]!]!, vertices[indexes[1]!]!, vertices[indexes[2]!]!] as MeshTriangle
    })

    objects.set(objectAttrs.id, triangles)
  }

  return objects
}

function parseXmlAttributes(source: string) {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]!.toLowerCase()] = match[2] ?? match[3]!
  }

  return attrs
}

function isIdentity3mfTransform(transform: string) {
  return transform.trim().split(/\s+/).map(Number).join(' ') === '1 0 0 0 1 0 0 0 1 0 0 0'
}

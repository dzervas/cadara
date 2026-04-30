import { strToU8, zipSync } from 'fflate'

import type { ExportCapabilities, MeshTriangle } from '@/contracts/export/capabilities'
import type { ExportProvider, ExportProviderInput } from '@/contracts/export/provider'
import type { ExportResult } from '@/contracts/export/result'
import type { DurableRef } from '@/contracts/shared/references'
import type { FeatureEditorFormSchema } from '@/core/feature-authoring/form-schema'

export interface ThreeMfMeshAccuracyOptions {
  chordTolerance: number
  angleToleranceRadians: number
}

export interface ThreeMfExportOptions {
  meshAccuracy: ThreeMfMeshAccuracyOptions
  unit: 'millimeter'
  includeMetadata: boolean
}

function getDefaultThreeMfMeshAccuracy(): ThreeMfMeshAccuracyOptions {
  return { chordTolerance: 0.05, angleToleranceRadians: 0.1 }
}

function formatXmlNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

type MeshPoint = readonly [number, number, number]

function createThreeMfModelXml(
  triangles: readonly MeshTriangle[],
  targetLabel: string,
  includeMetadata: boolean,
) {
  const vertices: string[] = []
  const triangleElements: string[] = []
  const vertexIndicesByKey = new Map<string, number>()

  function getVertexIndex(vertex: MeshPoint) {
    const x = formatXmlNumber(vertex[0])
    const y = formatXmlNumber(vertex[1])
    const z = formatXmlNumber(vertex[2])
    const key = `${x},${y},${z}`
    const existing = vertexIndicesByKey.get(key)

    if (existing !== undefined) {
      return existing
    }

    const index = vertices.length

    vertexIndicesByKey.set(key, index)
    vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`)

    return index
  }

  triangles.forEach((triangle) => {
    const [first, second, third] = triangle.vertices.map(getVertexIndex)
    triangleElements.push(`<triangle v1="${first}" v2="${second}" v3="${third}"/>`)
  })

  const metadata = includeMetadata
    ? `<metadata name="Title">${escapeXml(targetLabel)}</metadata>`
    : ''

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    metadata,
    '<resources>',
    '<object id="1" type="model">',
    '<mesh>',
    '<vertices>',
    vertices.join(''),
    '</vertices>',
    '<triangles>',
    triangleElements.join(''),
    '</triangles>',
    '</mesh>',
    '</object>',
    '</resources>',
    '<build>',
    '<item objectid="1"/>',
    '</build>',
    '</model>',
  ].join('')
}

function writeThreeMfPackage(
  triangles: readonly MeshTriangle[],
  targetLabel: string,
  includeMetadata: boolean,
) {
  const xml = createThreeMfModelXml(triangles, targetLabel, includeMetadata)

  return zipSync({
    '[Content_Types].xml': strToU8([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
      '</Types>',
    ].join('')),
    '_rels/.rels': strToU8([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
      '</Relationships>',
    ].join('')),
    '3D/3dmodel.model': strToU8(xml),
  }, { level: 0 })
}

function exportThreeMf(
  target: DurableRef,
  targetLabel: string,
  options: ThreeMfExportOptions,
  capabilities: ExportCapabilities,
): ExportResult {
  const result = capabilities.mesh.tessellate(target, options.meshAccuracy)

  if (!Array.isArray(result)) {
    return { ok: false, diagnostics: [result] }
  }

  const triangles = result

  if (triangles.length === 0) {
    return {
      ok: false,
      diagnostics: [{
        code: 'export-empty-mesh',
        severity: 'error',
        message: '3MF export could not produce triangles for the selected body.',
        target,
      }],
    }
  }

  return { ok: true, payload: writeThreeMfPackage(triangles, targetLabel, options.includeMetadata), diagnostics: [] }
}

export const threeMfExportProvider: ExportProvider<ThreeMfExportOptions, FeatureEditorFormSchema> = {
  id: '3mf',
  label: '3MF',
  formatId: '3mf',
  fileExtension: '3mf',
  mimeType: 'model/3mf',

  getDefaultOptions(): ThreeMfExportOptions {
    return {
      meshAccuracy: getDefaultThreeMfMeshAccuracy(),
      unit: 'millimeter',
      includeMetadata: true,
    }
  },

  getOptionFormSchema(options: ThreeMfExportOptions): FeatureEditorFormSchema {
    return {
      sections: [
        {
          id: 'mesh-accuracy',
          title: 'Mesh accuracy',
          fields: [
            {
              kind: 'numeric',
              id: 'chordTolerance',
              label: 'Chord tolerance',
              value: options.meshAccuracy.chordTolerance,
              input: 'number',
              step: 0.005,
              patch: { patchKey: 'meshAccuracy.chordTolerance' },
            },
            {
              kind: 'numeric',
              id: 'angleToleranceRadians',
              label: 'Angle tolerance',
              value: options.meshAccuracy.angleToleranceRadians,
              input: 'number',
              step: 0.01,
              patch: { patchKey: 'meshAccuracy.angleToleranceRadians' },
            },
            {
              kind: 'enum',
              id: 'unit',
              label: 'Unit',
              value: options.unit,
              options: [{ value: 'millimeter', label: 'Millimeter' }],
              patch: { patchKey: 'unit' },
            },
            {
              kind: 'custom',
              id: 'includeMetadata',
              label: 'Include metadata',
              rendererId: 'checkbox',
              payload: { checked: options.includeMetadata, patchKey: 'includeMetadata' },
            },
          ],
        },
      ],
    }
  },

  applyOptionPatch(options: ThreeMfExportOptions, patch: Record<string, unknown>): ThreeMfExportOptions {
    let current = { ...options, meshAccuracy: { ...options.meshAccuracy } }

    if (typeof patch['meshAccuracy.chordTolerance'] === 'number') {
      current.meshAccuracy.chordTolerance = patch['meshAccuracy.chordTolerance']
    }

    if (typeof patch['meshAccuracy.angleToleranceRadians'] === 'number') {
      current.meshAccuracy.angleToleranceRadians = patch['meshAccuracy.angleToleranceRadians']
    }

    if (patch['unit'] === 'millimeter') {
      current = { ...current, unit: patch['unit'] }
    }

    if (typeof patch['includeMetadata'] === 'boolean') {
      current = { ...current, includeMetadata: patch['includeMetadata'] }
    }

    return current
  },

  export(input: ExportProviderInput<ThreeMfExportOptions>): ExportResult {
    return exportThreeMf(input.target, input.targetLabel, input.options, input.capabilities)
  },
}

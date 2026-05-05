import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  geometryAssetManifestSchema,
  geometryAssetRecordSchema,
  legacyGeometryAssetManifestSchema,
} from '@/contracts/modeling/geometry-assets.runtime-schema'

test('geometry asset schema entrypoints accept structured Cadara B-rep and baked mesh records', () => {
  const cadaraRecord = makeCadaraBrepRecord()
  const bakedMeshRecord = makeBakedMeshRecord()

  const cadaraParsed = geometryAssetRecordSchema.safeParse(cadaraRecord)
  const bakedMeshParsed = geometryAssetRecordSchema.safeParse(bakedMeshRecord)

  expectTrue(cadaraParsed.success, `Expected structured Cadara B-rep record to parse: ${formatIssues(cadaraParsed)}`)
  expectTrue(bakedMeshParsed.success, `Expected structured baked mesh record to parse: ${formatIssues(bakedMeshParsed)}`)
  expectTrue(
    cadaraParsed.data.data?.kind === 'cadaraBrep'
      && bakedMeshParsed.data.data?.kind === 'bakedMeshGeometry',
    'Record entrypoints should preserve the structured asset data discriminants.',
  )
})

test('legacy geometry asset manifests normalize duplicate records with merged owner feature ids', () => {
  const first = makeBakedMeshRecord({
    assetId: 'asset_shared',
    ownerFeatureIds: ['feature_z', 'feature_a'],
  })
  const second = makeBakedMeshRecord({
    assetId: 'asset_shared',
    ownerFeatureIds: ['feature_b', 'feature_a'],
  })

  const parsed = legacyGeometryAssetManifestSchema.safeParse([first, second])

  expectTrue(parsed.success, `Expected legacy manifest normalization to succeed: ${formatIssues(parsed)}`)
  expectTrue(parsed.data.records.length === 1, 'Legacy manifests should normalize duplicate compatible records into one asset record.')
  expectTrue(
    parsed.data.records[0]?.ownerFeatureIds.join(',') === 'feature_a,feature_b,feature_z',
    'Legacy manifest normalization should merge and sort owner feature ids.',
  )

  const manifestParsed = geometryAssetManifestSchema.safeParse({
    schemaVersion: 'geometry-asset-manifest/v1alpha1',
    records: [second, first],
  })
  expectTrue(manifestParsed.success, `Expected manifest normalization to succeed: ${formatIssues(manifestParsed)}`)
  expectTrue(
    manifestParsed.data.records[0]?.assetId === 'asset_shared',
    'Versioned manifests should normalize records through the same entrypoint behavior.',
  )
})

test('geometry asset record schema rejects retained non-structured formats and mismatched structured payloads', () => {
  const unsupportedFormat = geometryAssetRecordSchema.safeParse({
    ...makeCadaraBrepRecord(),
    format: 'step',
  })
  const mismatchedCadaraPayload = geometryAssetRecordSchema.safeParse({
    ...makeCadaraBrepRecord(),
    data: makeBakedMeshRecord().data,
  })
  const mismatchedMeshPayload = geometryAssetRecordSchema.safeParse({
    ...makeBakedMeshRecord(),
    data: makeCadaraBrepRecord().data,
  })

  expectTrue(!unsupportedFormat.success, 'Retained STEP records should be rejected at the schema entrypoint.')
  expectTrue(hasIssue(unsupportedFormat, 'Only translated Cadara B-rep geometry and structured baked mesh geometry may be retained in authored documents.'), 'Unsupported retained formats should explain why authored documents only allow structured retained geometry.')
  expectTrue(!mismatchedCadaraPayload.success, 'Cadara B-rep records should reject baked mesh payloads.')
  expectTrue(hasIssue(mismatchedCadaraPayload, 'STEP-imported geometry must be stored as translated Cadara B-rep JSON data.'), 'Cadara B-rep records should require the Cadara B-rep data discriminant.')
  expectTrue(!mismatchedMeshPayload.success, 'Baked mesh records should reject Cadara B-rep payloads.')
  expectTrue(hasIssue(mismatchedMeshPayload, 'Baked mesh geometry must be stored as structured JSON data.'), 'Baked mesh records should require the baked mesh data discriminant.')
})

test('geometry asset record schema reports weighted-curve refinement failures at the record entrypoint', () => {
  const invalidEdgeWeights = makeCadaraBrepRecord({
    data: {
      ...makeCadaraBrepRecord().data!,
      bodies: [
        {
          ...makeCadaraBrepRecord().data!.bodies[0]!,
          topology: {
            ...makeCadaraBrepRecord().data!.bodies[0]!.topology,
            edges: [
              {
                ...makeCadaraBrepRecord().data!.bodies[0]!.topology.edges[0]!,
                curve: {
                  kind: 'bezier',
                  poles: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
                  weights: [1, 2],
                  parameterRange: [0, 1],
                },
              },
              ...makeCadaraBrepRecord().data!.bodies[0]!.topology.edges.slice(1),
            ],
            coedges: [
              {
                ...makeCadaraBrepRecord().data!.bodies[0]!.topology.coedges[0]!,
                curve2d: {
                  kind: 'bSpline',
                  degree: 2,
                  periodic: false,
                  poles: [[0, 0], [1, 0], [1, 1]],
                  knots: [0, 1, 2],
                  multiplicities: [1, 1],
                  parameterRange: [0, 1],
                },
              },
              ...makeCadaraBrepRecord().data!.bodies[0]!.topology.coedges.slice(1),
            ],
          },
        },
      ],
    },
  })

  const parsed = geometryAssetRecordSchema.safeParse(invalidEdgeWeights)

  expectTrue(!parsed.success, 'Weighted curve invariants should fail when weights or multiplicities do not align.')
  expectTrue(hasIssue(parsed, 'Cadara B-rep spline weights must align 1:1 with poles.'), 'Curve weight-count mismatches should report a seam-level refinement error.')
  expectTrue(hasIssue(parsed, 'Cadara B-rep spline multiplicities must align 1:1 with knots.'), 'Curve knot/multiplicity mismatches should report a seam-level refinement error.')
})

test('geometry asset schema accepts compact analytic B-rep solids with single-coedge loops', () => {
  const base = makeCadaraBrepRecord()
  const compactRecord = makeCadaraBrepRecord({
    data: {
      ...base.data!,
      bodies: [{
        ...base.data!.bodies[0]!,
        topology: {
          vertices: base.data!.bodies[0]!.topology.vertices.slice(0, 2),
          edges: [base.data!.bodies[0]!.topology.edges[0]!],
          coedges: [base.data!.bodies[0]!.topology.coedges[0]!],
          loops: [{
            loopKey: 'loop_single_coedge',
            coedgeIndices: [0],
          }],
          faces: base.data!.bodies[0]!.topology.faces.slice(0, 3).map((face) => ({
            ...face,
            loopIndices: [0],
          })),
          shells: [{
            shellKey: 'shell_compact',
            faceIndices: [0, 1, 2],
            closed: true,
          }],
          solids: [{
            solidKey: 'solid_compact',
            shellIndices: [0],
          }],
        },
      }],
    },
  })

  const parsed = geometryAssetRecordSchema.safeParse(compactRecord)

  expectTrue(parsed.success, `Expected compact analytic B-rep topology to parse: ${formatIssues(parsed)}`)
})

test('geometry asset record schema reports weighted-surface and topology reference failures at the record entrypoint', () => {
  const base = makeCadaraBrepRecord()
  const invalidSurface = geometryAssetRecordSchema.safeParse({
    ...base,
    data: {
      ...base.data!,
      bodies: [
        {
          ...base.data!.bodies[0]!,
          topology: {
            ...base.data!.bodies[0]!.topology,
            edges: [
              {
                ...base.data!.bodies[0]!.topology.edges[0]!,
                vertices: [99, 1],
              },
              ...base.data!.bodies[0]!.topology.edges.slice(1),
            ],
            faces: [
              {
                ...base.data!.bodies[0]!.topology.faces[0]!,
                surface: {
                  kind: 'bSpline',
                  uDegree: 2,
                  vDegree: 2,
                  uPeriodic: false,
                  vPeriodic: false,
                  uPoleCount: 2,
                  vPoleCount: 2,
                  poles: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
                  weights: [1, 1, 1],
                  uKnots: [0, 1],
                  vKnots: [0, 1],
                  uMultiplicities: [1, 1],
                  vMultiplicities: [1],
                },
                meshVertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
                triangles: [[0, 1, 2]],
              },
              {
                ...base.data!.bodies[0]!.topology.faces[1]!,
                surface: {
                  kind: 'surfaceOfLinearExtrusion',
                  direction: [0, 0, 1],
                  basisCurve: {
                    kind: 'bezier',
                    poles: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
                    weights: [1, 1],
                    parameterRange: [0, 1],
                  },
                },
              },
              ...base.data!.bodies[0]!.topology.faces.slice(2),
            ],
          },
        },
      ],
    },
  })

  expectTrue(!invalidSurface.success, 'Surface and topology entrypoint refinements should reject invalid structured B-rep payloads.')
  expectTrue(hasIssue(invalidSurface, 'Cadara B-rep edge references a missing vertex.'), 'Topology reference mismatches should surface at the record entrypoint.')
  expectTrue(hasIssue(invalidSurface, 'Cadara B-rep surface poles must match the declared U/V pole counts.'), 'Surface pole-count mismatches should be reported by the schema entrypoint.')
  expectTrue(hasIssue(invalidSurface, 'Cadara B-rep surface weights must align 1:1 with poles.'), 'Surface weight-count mismatches should be reported by the schema entrypoint.')
  expectTrue(hasIssue(invalidSurface, 'Cadara B-rep V multiplicities must align 1:1 with V knots.'), 'Surface knot/multiplicity mismatches should be reported by the schema entrypoint.')
  expectTrue(hasIssue(invalidSurface, 'Cadara B-rep spline weights must align 1:1 with poles.'), 'Weighted basis curves on extruded/revolved surfaces should also be validated at the record entrypoint.')
})

function hasIssue(result: { success: false; error: { issues: { message: string }[] } }, message: string) {
  return result.error.issues.some((issue) => issue.message === message)
}

function formatIssues(result: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) {
  return result.success
    ? ''
    : result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') ?? 'unknown issues'
}

function makeCadaraBrepRecord(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'geometry-asset/v1alpha1',
    assetId: 'asset_cadara',
    hash: `sha256:${'a'.repeat(64)}`,
    byteLength: 128,
    format: 'cadara-brep',
    mediaType: 'application/vnd.cadara-brep+json',
    provenance: {
      kind: 'imported',
      sourceName: 'part.step',
      sourceFormat: 'step',
      sourceStored: false,
    },
    data: {
      kind: 'cadaraBrep',
      schemaVersion: 'cadara-brep/v1alpha1',
      source: {
        importedFormat: 'step',
        sourceStored: false,
        rootDocumentName: 'part.step',
      },
      bodies: [
        {
          bodyKey: 'body_1',
          label: 'Body 1',
          solidKey: 'solid_1',
          topology: makeCadaraTopology(),
        },
      ],
    },
    ownerFeatureIds: ['feature_a'],
    ...overrides,
  }
}

function makeBakedMeshRecord(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'geometry-asset/v1alpha1',
    assetId: 'asset_mesh',
    hash: `sha256:${'b'.repeat(64)}`,
    byteLength: 64,
    format: 'baked-mesh',
    mediaType: 'application/vnd.cadara-baked-mesh+json',
    provenance: {
      kind: 'generated',
      generator: 'mesh-export',
    },
    data: {
      kind: 'bakedMeshGeometry',
      schemaVersion: 'baked-mesh-geometry/v1alpha1',
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      indices: [[0, 1, 2]],
    },
    ownerFeatureIds: ['feature_mesh'],
    ...overrides,
  }
}

function makeCadaraTopology() {
  return {
    vertices: [
      { vertexKey: 'v0', point: [0, 0, 0] },
      { vertexKey: 'v1', point: [1, 0, 0] },
      { vertexKey: 'v2', point: [1, 1, 0] },
      { vertexKey: 'v3', point: [0, 1, 0] },
    ],
    edges: [
      {
        edgeKey: 'e0',
        vertices: [0, 1],
        curve: {
          kind: 'bezier',
          poles: [[0, 0, 0], [0.5, 0, 0], [1, 0, 0]],
          weights: [1, 1, 1],
          parameterRange: [0, 1],
        },
      },
      {
        edgeKey: 'e1',
        vertices: [1, 2],
        curve: {
          kind: 'bSpline',
          degree: 2,
          periodic: false,
          poles: [[1, 0, 0], [1.2, 0.5, 0], [1, 1, 0]],
          weights: [1, 1, 1],
          knots: [0, 1],
          multiplicities: [1, 1],
          parameterRange: [0, 1],
        },
      },
      {
        edgeKey: 'e2',
        vertices: [2, 3],
        curve: {
          kind: 'line',
          origin: [1, 1, 0],
          direction: [-1, 0, 0],
          parameterRange: [0, 1],
        },
      },
      {
        edgeKey: 'e3',
        vertices: [3, 0],
        curve: {
          kind: 'circle',
          center: [0.5, 0.5, 0],
          axisDirection: [0, 0, 1],
          xDirection: [1, 0, 0],
          radius: 0.5,
          parameterRange: [0, 3.14],
        },
      },
      {
        edgeKey: 'e4',
        vertices: [0, 2],
        curve: {
          kind: 'ellipse',
          center: [0.5, 0.5, 0],
          axisDirection: [0, 0, 1],
          xDirection: [1, 0, 0],
          majorRadius: 1,
          minorRadius: 0.5,
          parameterRange: [0, 1.57],
        },
      },
      {
        edgeKey: 'e5',
        vertices: [1, 3],
        curve: {
          kind: 'line',
          origin: [1, 0, 0],
          direction: [-1, 1, 0],
          parameterRange: [0, 1],
        },
      },
    ],
    coedges: [
      {
        coedgeKey: 'c0',
        edgeIndex: 0,
        reversed: false,
        curve2d: {
          kind: 'polyline',
          points: [[0, 0], [1, 0], [1, 1]],
          parameterRange: [0, 1],
        },
      },
      {
        coedgeKey: 'c1',
        edgeIndex: 1,
        reversed: false,
        curve2d: {
          kind: 'bezier',
          poles: [[0, 0], [0.5, 0], [1, 0]],
          weights: [1, 1, 1],
          parameterRange: [0, 1],
        },
      },
      {
        coedgeKey: 'c2',
        edgeIndex: 2,
        reversed: true,
        curve2d: {
          kind: 'bSpline',
          degree: 2,
          periodic: false,
          poles: [[0, 0], [1, 0], [1, 1]],
          weights: [1, 1, 1],
          knots: [0, 1],
          multiplicities: [1, 1],
          parameterRange: [0, 1],
        },
      },
    ],
    loops: [
      {
        loopKey: 'loop_0',
        coedgeIndices: [0, 1, 2],
      },
    ],
    faces: [
      {
        faceKey: 'f0',
        loopIndices: [0],
        surface: {
          kind: 'bSpline',
          uDegree: 2,
          vDegree: 2,
          uPeriodic: false,
          vPeriodic: false,
          uPoleCount: 2,
          vPoleCount: 2,
          poles: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]],
          weights: [1, 1, 1, 1],
          uKnots: [0, 1],
          vKnots: [0, 1],
          uMultiplicities: [1, 1],
          vMultiplicities: [1, 1],
        },
        meshVertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        triangles: [[0, 1, 2]],
      },
      {
        faceKey: 'f1',
        loopIndices: [0],
        surface: {
          kind: 'plane',
          frame: {
            origin: [0, 0, 0],
            zDirection: [0, 0, 1],
            xDirection: [1, 0, 0],
          },
        },
        meshVertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        triangles: [[0, 1, 2]],
      },
      {
        faceKey: 'f2',
        loopIndices: [0],
        surface: {
          kind: 'surfaceOfRevolution',
          axisOrigin: [0, 0, 0],
          axisDirection: [0, 0, 1],
          basisCurve: {
            kind: 'bezier',
            poles: [[0, 0, 0], [0.5, 0.5, 0], [1, 1, 0]],
            weights: [1, 1, 1],
            parameterRange: [0, 1],
          },
        },
        meshVertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        triangles: [[0, 1, 2]],
      },
      {
        faceKey: 'f3',
        loopIndices: [0],
        surface: {
          kind: 'surfaceOfLinearExtrusion',
          direction: [0, 0, 1],
          basisCurve: {
            kind: 'bSpline',
            degree: 2,
            periodic: false,
            poles: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
            weights: [1, 1, 1],
            knots: [0, 1],
            multiplicities: [1, 1],
            parameterRange: [0, 1],
          },
        },
        meshVertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        triangles: [[0, 1, 2]],
      },
    ],
    shells: [
      {
        shellKey: 'shell_0',
        faceIndices: [0, 1, 2, 3],
        closed: true,
      },
    ],
    solids: [
      {
        solidKey: 'solid_0',
        shellIndices: [0],
      },
    ],
  }
}

import { test } from 'bun:test'

import {
  createBakedMeshGeometryAsset,
  createMeshSizeLimitEvaluation,
  evaluateMeshReconstructionFallbacks,
  parseBakedMeshGeometry,
} from '@/domain/modeling/baked-mesh-geometry'
import type { GeometryAssetHash } from '@/contracts/modeling/geometry-assets'
import type { FeatureId } from '@/contracts/shared/ids'
import type { MeshPoint, MeshTriangle } from '@/domain/modeling/mesh-parser'

test('src/domain/modeling/baked-mesh-geometry.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const sourceHash = `sha256:${'a'.repeat(64)}` as GeometryAssetHash
  const ownerFeatureId = 'feature_meshImport-1' as FeatureId

  function cubeTriangles(): MeshTriangle[] {
    return [
      [[0, 0, 0], [1, 1, 0], [1, 0, 0]],
      [[0, 0, 0], [0, 1, 0], [1, 1, 0]],
      [[0, 0, 1], [1, 0, 1], [1, 1, 1]],
      [[0, 0, 1], [1, 1, 1], [0, 1, 1]],
      [[0, 0, 0], [1, 0, 0], [1, 0, 1]],
      [[0, 0, 0], [1, 0, 1], [0, 0, 1]],
      [[1, 0, 0], [1, 1, 0], [1, 1, 1]],
      [[1, 0, 0], [1, 1, 1], [1, 0, 1]],
      [[1, 1, 0], [0, 1, 0], [0, 1, 1]],
      [[1, 1, 0], [0, 1, 1], [1, 1, 1]],
      [[0, 1, 0], [0, 0, 0], [0, 0, 1]],
      [[0, 1, 0], [0, 0, 1], [0, 1, 1]],
    ]
  }

  function cylinderTriangles(segments = 16, radius = 1, height = 2): MeshTriangle[] {
    const bottomCenter: MeshPoint = [0, 0, 0]
    const topCenter: MeshPoint = [0, 0, height]
    const bottom = Array.from({ length: segments }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2
      return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0] as MeshPoint
    })
    const top = bottom.map((point) => [point[0], point[1], height] as MeshPoint)
    const triangles: MeshTriangle[] = []

    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments
      triangles.push(
        [bottom[index]!, bottom[next]!, top[next]!],
        [bottom[index]!, top[next]!, top[index]!],
        [bottomCenter, bottom[index]!, bottom[next]!],
        [topCenter, top[next]!, top[index]!],
      )
    }

    return triangles
  }

  function tetrahedronTriangles(): MeshTriangle[] {
    return [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 0, 0], [0, 0, 1], [1, 0, 0]],
      [[0, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
    ]
  }

  const cubeEvaluation = evaluateMeshReconstructionFallbacks(cubeTriangles())
  assert(cubeEvaluation.resultClassification === 'analytic', 'Clean planar cube meshes should classify as analytic.')
  assert(cubeEvaluation.qualityMetrics.planarRegionCount === 6, 'Cube reconstruction should recover six planar regions.')

  const cylinderEvaluation = evaluateMeshReconstructionFallbacks(cylinderTriangles())
  assert(cylinderEvaluation.resultClassification === 'analytic', 'Clean cylinder meshes should classify as analytic.')
  assert(cylinderEvaluation.qualityMetrics.cylindricalRegionCount === 1, 'Cylinder reconstruction should recover one cylindrical region.')

  const noisyCylinder = cylinderTriangles()
  noisyCylinder[0] = [[1.2, 0, 0], noisyCylinder[0]![1], noisyCylinder[0]![2]]
  const noisyEvaluation = evaluateMeshReconstructionFallbacks(noisyCylinder)
  assert(noisyEvaluation.resultClassification === 'rejected', 'Noisy coordinate edits that break manifold topology should reject.')

  const tetraEvaluation = evaluateMeshReconstructionFallbacks(tetrahedronTriangles())
  assert(tetraEvaluation.resultClassification === 'facetedFallback', 'Unsupported closed analytic recovery should fall back to faceted baked geometry.')

  const fallbackWithoutAcceptance = await createBakedMeshGeometryAsset({
    triangles: tetrahedronTriangles(),
    sourceFileName: 'tetra.stl',
    sourceFormat: 'stl',
    sourceHash,
    ownerFeatureId,
  })
  assert(!fallbackWithoutAcceptance.ok, 'Faceted fallback should require explicit acceptance before commit.')
  assert(
    !fallbackWithoutAcceptance.ok && fallbackWithoutAcceptance.diagnosticCode === 'mesh-import-faceted-fallback-acceptance-required',
    'Unaccepted faceted fallback should report a stable diagnostic code.',
  )

  const fallbackAccepted = await createBakedMeshGeometryAsset({
    triangles: tetrahedronTriangles(),
    sourceFileName: 'tetra.stl',
    sourceFormat: 'stl',
    sourceHash,
    ownerFeatureId,
    acceptFacetedFallback: true,
  })
  assert(fallbackAccepted.ok, 'Accepted faceted fallback should bake durable geometry.')
  assert(
    fallbackAccepted.ok && fallbackAccepted.reconstruction.resultClassification === 'facetedFallback',
    'Accepted fallback provenance should preserve the faceted classification.',
  )
  assert(
    fallbackAccepted.ok && fallbackAccepted.assetInput.asset.provenance.sourceStored === false,
    'Baked mesh provenance should keep sourceStored false.',
  )
  assert(
    fallbackAccepted.ok && fallbackAccepted.assetInput.asset.provenance.reconstruction?.sourceHash === sourceHash,
    'Baked mesh asset provenance should record the reconstruction source hash.',
  )
  assert(
    fallbackAccepted.ok && parseBakedMeshGeometry(fallbackAccepted.assetInput.bytes).indices.length === 4,
    'Restore payload should contain baked triangles rather than source mesh bytes.',
  )

  const limitedEvaluation = evaluateMeshReconstructionFallbacks(tetrahedronTriangles(), {
    ...tetraEvaluation.settings,
    maxFacetedTriangles: 2,
  })
  assert(
    limitedEvaluation.resultClassification === 'meshBodyException',
    'Faceted fallback should classify size-limit overflows as mesh-body exceptions.',
  )
  assert(
    limitedEvaluation.rejectionReason?.includes('Persistent mesh body fallback is not enabled'),
    'Mesh-body fallback cases should explain that persistent mesh bodies are disabled.',
  )
  const preflightLimitedEvaluation = createMeshSizeLimitEvaluation({
    triangleCount: 50_001,
  })
  assert(
    preflightLimitedEvaluation?.resultClassification === 'meshBodyException' &&
      preflightLimitedEvaluation.qualityMetrics.triangleCount === 50_001,
    'Preflight size-limit evaluation should reject oversized binary STL payloads before triangle parsing.',
  )

  const limitedBake = await createBakedMeshGeometryAsset({
    triangles: tetrahedronTriangles(),
    sourceFileName: 'tetra.stl',
    sourceFormat: 'stl',
    sourceHash,
    ownerFeatureId,
    settings: {
      ...tetraEvaluation.settings,
      maxFacetedTriangles: 2,
    },
  })
  assert(!limitedBake.ok, 'Mesh-body fallback should still block commits when faceted limits are exceeded.')
  assert(
    !limitedBake.ok && limitedBake.diagnosticCode === 'mesh-import-mesh-body-fallback-disabled',
    'Disabled mesh-body fallback should report the dedicated diagnostic code.',
  )
})

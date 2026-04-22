import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/app/cad-workbench-mesh-import.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const source = readFileSync(join(process.cwd(), 'src/app/cad-workbench.tsx'), 'utf8')
  const workerSource = readFileSync(join(process.cwd(), 'src/domain/modeling/mesh-import-review.worker.ts'), 'utf8')

  assert(
    source.includes('reviewMeshImportWithWorker(file.name, bytes, taskSequence)') &&
      workerSource.includes('evaluateMeshReconstructionFallbacks(parsed.triangles)') &&
      workerSource.includes('createBakedMeshGeometryAsset({'),
    'Mesh import review should parse, reconstruct, and prepare baked mesh assets in the worker.',
  )
  assert(
    source.includes('file.slice(0, 84).arrayBuffer()') &&
      source.includes('getBinaryStlTriangleCount({ headerBytes, byteLength: file.size })') &&
      source.includes('createMeshSizeLimitEvaluation({ triangleCount })'),
    'Mesh import review should reject oversized binary STL files before loading or parsing every triangle on the UI thread.',
  )
  assert(
    source.includes("showWorkbenchError(error instanceof Error ? error.message : 'Mesh import failed.')"),
    'Mesh import review parse failures should stay user-facing instead of becoming unexpected workbench exceptions.',
  )
  assert(
    source.includes('formatMeshReconstructionClassification(meshImportFlow.reconstruction.resultClassification)'),
    'Mesh import review should show the reconstruction classification.',
  )
  assert(
    source.includes('The saved result will be faceted baked geometry'),
    'Mesh import review should warn before accepting faceted fallback.',
  )
  assert(
    source.includes('modelingService.importPreparedMeshFile') &&
      source.includes('assetInput: review.assetInput'),
    'Mesh import commit should use the worker-prepared baked mesh asset instead of reparsing source bytes.',
  )
  assert(
    source.includes('mesh body fallback {meshImportFlow.reconstruction.settings.meshBodyFallback}'),
    'Mesh import review should show reconstruction settings, including disabled mesh body fallback.',
  )
  assert(
    source.includes('data-mesh-import-progress') &&
      source.includes('Mesh import progress') &&
      source.includes('cancelMeshImportPreparation') &&
      source.includes('meshImportFileReaderRef.current?.abort()'),
    'Mesh import preparation should expose cancellable non-blocking progress UI.',
  )
  assert(
    source.includes('maxFacetedTriangles.toLocaleString()'),
    'Mesh import review should tell users the current faceted fallback triangle cap.',
  )
})

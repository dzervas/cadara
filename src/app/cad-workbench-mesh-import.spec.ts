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

  assert(
    source.includes('evaluateMeshReconstructionFallbacks(parsed.triangles)'),
    'Mesh import review should evaluate reconstruction quality before commit.',
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
    source.includes("acceptFacetedFallback: review.reconstruction.resultClassification === 'facetedFallback'"),
    'Mesh import commit should pass explicit faceted fallback acceptance.',
  )
  assert(
    source.includes('mesh body fallback {meshImportFlow.reconstruction.settings.meshBodyFallback}'),
    'Mesh import review should show reconstruction settings, including disabled mesh body fallback.',
  )
})

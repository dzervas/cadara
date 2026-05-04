import { test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { expectTrue } from '@/testing/expect.spec'
import type { BodyId, FeatureId } from '@/contracts/shared/ids'
import { createOccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import { toGpPnt } from '@/domain/modeling/occ/planes'
import { trackNewSolidBody } from '@/domain/modeling/occ/topology'
import { createOccExportCapabilities } from '@/domain/export/occ-export-capabilities'

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>

test('src/domain/export/occ-export-capabilities.spec.ts', async () => {
  async function loadCustomOpenCascadeForTest() {
    const module = await import('../../../public/cadara-occ.js') as {
      default: CustomOpenCascadeMainJSForTest
    }
    const wasmBinary = new Uint8Array(
      await readFile(new URL('../../../public/cadara-occ.wasm', import.meta.url)),
    )

    return new module.default({ wasmBinary })
  }

  async function testMeshExportConsumesNativePayloadWithoutJsFaceTriangulation() {
    const oc = await loadCustomOpenCascadeForTest()
    const builder = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 1, 2, 3)
    builder.Build(new oc.Message_ProgressRange_1())
    expectTrue(builder.IsDone(), 'Expected OCC box builder to produce a test export body.')

    const body = trackNewSolidBody(oc, {
      bodyId: 'body_native_mesh_export' as BodyId,
      label: 'Native mesh export body',
      ownerFeatureId: 'feature_native_mesh_export' as FeatureId,
      shape: builder.Shape(),
    })
    const state = createOccAuthoringState(oc, { bodies: [body] })
    const originalTriangulation = oc.BRep_Tool.Triangulation
    let triangulationCallCount = 0

    oc.BRep_Tool.Triangulation = (() => {
      triangulationCallCount += 1
      throw new Error('Mesh export must use the native payload builder, not JS face triangulation.')
    }) as typeof originalTriangulation

    try {
      const capabilities = createOccExportCapabilities(state)
      const result = await capabilities.mesh.tessellate(
        { kind: 'body', bodyId: body.bodyId },
        {
          chordTolerance: 0.1,
          angleToleranceRadians: 0.5,
        },
      )

      expectTrue(Array.isArray(result), 'Native OCC mesh export should return tessellated triangles.')
      if (!Array.isArray(result)) {
        return
      }

      expectTrue(
        triangulationCallCount === 0,
        'Native OCC mesh export must not call the JS BRep_Tool.Triangulation binding.',
      )
      expectTrue(result.length === 12, 'Native box mesh export should produce twelve triangles.')
      expectTrue(
        result.every((triangle) => triangle.vertices.length === 3 && triangle.normal.length === 3),
        'Native mesh export triangles should include three vertices and a derived normal.',
      )
    } finally {
      oc.BRep_Tool.Triangulation = originalTriangulation
      builder.delete?.()
    }
  }

  await testMeshExportConsumesNativePayloadWithoutJsFaceTriangulation()
})

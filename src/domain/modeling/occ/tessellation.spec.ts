import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  degreesToOccAngularDeflectionRadians,
  getOccTessellationTier,
  selectBodyLodTier,
  selectViewportLodTierForRenderables,
} from '@/domain/modeling/occ/tessellation'
import type { RenderableEntityRecord } from '@/contracts/render/schema'

test('src/domain/modeling/occ/tessellation.spec.ts', () => {  const startup = getOccTessellationTier('startup')
  const fine = getOccTessellationTier('fine')

  expectTrue(
    degreesToOccAngularDeflectionRadians(180) === Math.PI,
    'OCC angular deflection unit audit should convert degree-equivalent settings to radians.',
  )
  expectTrue(
    startup.linearDeflectionModelUnits >= 0.5 && startup.linearDeflectionModelUnits <= 1.0,
    'Startup tessellation should use coarse 0.5 to 1.0 model-unit linear deflection.',
  )
  expectTrue(
    startup.angularDeflectionRadians === 0.5 && startup.angularDeflectionDegreeEquivalent > 2,
    'Startup tessellation should keep the existing angular value because it is already coarser than 1-2 degrees.',
  )
  expectTrue(
    fine.linearDeflectionModelUnits < startup.linearDeflectionModelUnits,
    'Fine tessellation should refine geometry without changing topology bindings.',
  )
  expectTrue(
    selectBodyLodTier({ bodyRadiusModelUnits: 1, cameraDistanceModelUnits: 40 }) === 'startup',
    'Far bodies should select coarse startup LOD.',
  )
  expectTrue(
    selectBodyLodTier({ bodyRadiusModelUnits: 4, cameraDistanceModelUnits: 10 }) === 'fine',
    'Close bodies should select fine LOD refinement.',
  )

  const bodyRenderable = {
    ownerBodyId: 'body_1',
    binding: {
      target: { kind: 'face', bodyId: 'body_1', faceId: 'face_1' },
    },
    geometry: {
      kind: 'mesh',
      vertexPositions: [
        [-1, -1, 0],
        [1, -1, 0],
        [1, 1, 0],
        [-1, 1, 0],
      ],
      vertexNormals: null,
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    },
  } as RenderableEntityRecord

  expectTrue(
    selectViewportLodTierForRenderables({
      cameraPosition: [0, 0, 50],
      renderables: [bodyRenderable],
    }) === 'startup',
    'Camera-driven LOD should keep far body renderables on the coarse tier.',
  )
  expectTrue(
    selectViewportLodTierForRenderables({
      cameraPosition: [0, 0, 4],
      renderables: [bodyRenderable],
    }) === 'fine',
    'Camera-driven LOD should request fine meshes when zoomed close to a body.',
  )
  expectTrue(
    bodyRenderable.binding.target.kind === 'face' &&
      bodyRenderable.binding.target.bodyId === 'body_1' &&
      bodyRenderable.binding.target.faceId === 'face_1',
    'LOD selection must not rewrite durable selection targets.',
  )
})

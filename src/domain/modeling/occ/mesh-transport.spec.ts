import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import { packWorkspaceSnapshotRenderMeshes, unpackWorkspaceSnapshotRenderMeshes } from '@/domain/modeling/occ/mesh-transport'

test('src/domain/modeling/occ/mesh-transport.spec.ts', () => {  const meshRecord = {
    id: 'renderable_occ_face_body_1_face_1',
    label: 'Body face',
    ownerBodyId: 'body_1',
    ownerFeatureId: 'feature_1',
    binding: {
      pickId: 'pick_occ_face_body_1_face_1',
      pickPriority: 20,
      target: { kind: 'face', bodyId: 'body_1', faceId: 'face_1' },
      topology: 'face',
      semanticClass: 'bodyFace',
    },
    geometry: {
      kind: 'mesh',
      vertexPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      vertexNormals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      triangleIndices: [[0, 1, 2]],
    },
  } as RenderableEntityRecord
  const snapshot = {
    document: {
      render: {
        records: [meshRecord],
      },
    },
    render: {
      records: [meshRecord],
    },
  } as WorkspaceSnapshot

  const packed = packWorkspaceSnapshotRenderMeshes(snapshot)
  const packedGeometry = packed.snapshot.document.render.records[0]?.geometry

  expectTrue(packedGeometry?.kind === 'packedMesh', 'Worker mesh transport should pack mesh records into typed-array views.')
  expectTrue(
    packedGeometry.vertexPositions.byteOffset === 0 &&
      packedGeometry.vertexPositions.byteLength === 36 &&
      packedGeometry.vertexPositions.elementCount === 9,
    'Packed mesh positions should carry explicit view metadata.',
  )
  expectTrue(
    packed.transferList.includes(packedGeometry.vertexPositions.buffer),
    'Packed mesh buffers should be included in the worker transfer list.',
  )

  const unpacked = unpackWorkspaceSnapshotRenderMeshes(packed.snapshot)
  const unpackedGeometry = unpacked.document.render.records[0]?.geometry

  expectTrue(unpackedGeometry?.kind === 'mesh', 'Main-thread unpacking should reconstruct public mesh geometry records.')
  expectTrue(
    unpackedGeometry.vertexPositions[1]?.[0] === 1 &&
      unpackedGeometry.triangleIndices[0]?.[2] === 2,
    'Reconstructed mesh geometry should preserve positions and triangle indices.',
  )
})

import { test } from 'bun:test'
import * as THREE from 'three'

import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { FaceId, PickId, RenderableId } from '@/contracts/shared/ids'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import {
  createSectionCapRenderables,
  createSectionClippingPlane,
  resolveSectionDragOffset,
} from '@/domain/section-view/rendering'
import type { SectionViewSession } from '@/core/section-view/session'

test('src/domain/section-view/rendering.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createSection(retainedSide: SectionViewSession['retainedSide']): SectionViewSession {
    return {
      seed: { kind: 'construction', constructionId: 'construction_plane-xy' },
      plane: createStandardPlaneDefinition('xy'),
      offset: 0,
      retainedSide,
    }
  }

  function createFaceRenderable(
    id: string,
    vertices: readonly (readonly [number, number, number])[],
    triangles: readonly (readonly [number, number, number])[],
  ): RenderableEntityRecord {
    return {
      id: id as RenderableId,
      label: id,
      ownerBodyId: 'body_box',
      ownerFeatureId: null,
      binding: {
        pickId: `pick_${id}` as PickId,
        pickPriority: 5,
        target: { kind: 'face', bodyId: 'body_box', faceId: `${id}_face` as FaceId },
        topology: 'face',
        semanticClass: 'bodyFace',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: vertices,
        vertexNormals: vertices.map(() => [0, 0, 1] as const),
        triangleIndices: triangles,
      },
    }
  }

  {
    const positive = createSectionClippingPlane(createSection('positive'))
    const negative = createSectionClippingPlane(createSection('negative'))

    assert(positive.distanceToPoint(new THREE.Vector3(0, 0, 1)) > 0, 'Positive retained side should keep positive-Z points.')
    assert(positive.distanceToPoint(new THREE.Vector3(0, 0, -1)) < 0, 'Positive retained side should clip negative-Z points.')
    assert(negative.distanceToPoint(new THREE.Vector3(0, 0, -1)) > 0, 'Negative retained side should keep negative-Z points.')
  }

  {
    const boxFaces = [
      createFaceRenderable('front', [
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
        [-1, -1, 1],
      ], [[0, 1, 2], [0, 2, 3]]),
      createFaceRenderable('back', [
        [-1, 1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [-1, 1, 1],
      ], [[0, 2, 1], [0, 3, 2]]),
      createFaceRenderable('left', [
        [-1, -1, -1],
        [-1, 1, -1],
        [-1, 1, 1],
        [-1, -1, 1],
      ], [[0, 1, 2], [0, 2, 3]]),
      createFaceRenderable('right', [
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, -1, 1],
      ], [[0, 2, 1], [0, 3, 2]]),
    ]
    const caps = createSectionCapRenderables(boxFaces, createSection('positive'))

    assert(caps.length > 0, 'Intersecting the visible box faces should derive at least one transient section cap.')
    assert(
      caps.every((cap) =>
        cap.vertexPositions.length === cap.vertexNormals.length
        && cap.vertexPositions.length === cap.textureCoordinates.length
        && cap.triangleIndices.length > 0,
      ),
      'Derived section caps should carry positions, normals, texture coordinates, and triangulation.',
    )
  }

  {
    const offset = resolveSectionDragOffset({
      pointerRayOrigin: [10, 0, 10],
      pointerRayDirection: [-0.8574929257125441, 0, -0.5144957554275265],
      section: {
        ...createSection('positive'),
        offset: 2,
      },
    })

    assert(offset !== null, 'Section drag should resolve an offset from a non-parallel pointer ray.')
    assert(Math.abs(offset - 4) < 0.05, 'Section drag should stay constrained to the section normal axis.')
  }
})

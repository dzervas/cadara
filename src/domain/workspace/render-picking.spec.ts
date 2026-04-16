import { test } from 'bun:test'
import * as THREE from 'three'

import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  MARKER_SPHERE_GEOMETRY,
  DEFAULT_LINE_PICK_THRESHOLD,
  bindRenderableObject,
  collectBindings,
  createInvisiblePickMaterial,
  createMarkerPickProxy,
  getVisibleMarkerRadius,
  resolvePickTarget,
  updateWorkspaceHighlight,
} from '@/domain/workspace/render-picking'

test('src/domain/workspace/render-picking.spec.ts', async () => {
  function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function assertEqual<T>(actual: T, expected: T, message = 'Expected values to be equal') {
    if (actual !== expected) {
      throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`)
    }
  }

  function assertDeepEqual(actual: unknown, expected: unknown, message = 'Expected values to be deeply equal') {
    const actualJson = JSON.stringify(actual)
    const expectedJson = JSON.stringify(expected)

    if (actualJson !== expectedJson) {
      throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}`)
    }
  }

  const faceRenderable: RenderableEntityRecord = {
    id: 'renderable_face',
    label: 'Face',
    ownerBodyId: 'body_a',
    ownerFeatureId: null,
    binding: {
      pickId: 'pick_face',
      pickPriority: 20,
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
      topology: 'face',
      semanticClass: 'bodyFace',
    },
    geometry: {
      kind: 'mesh',
      vertexPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
      vertexNormals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    },
  }

  const edgeRenderable: RenderableEntityRecord = {
    id: 'renderable_edge',
    label: 'Edge',
    ownerBodyId: 'body_a',
    ownerFeatureId: null,
    binding: {
      pickId: 'pick_edge',
      pickPriority: 10,
      target: { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_top' },
      topology: 'edge',
      semanticClass: 'featureEdge',
    },
    geometry: {
      kind: 'polyline',
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      isClosed: false,
    },
  }

  const vertexRenderable: RenderableEntityRecord = {
    id: 'renderable_vertex',
    label: 'Vertex',
    ownerBodyId: 'body_a',
    ownerFeatureId: null,
    binding: {
      pickId: 'pick_vertex',
      pickPriority: 0,
      target: { kind: 'vertex', bodyId: 'body_a', vertexId: 'vertex_top_right' },
      topology: 'vertex',
      semanticClass: 'featureVertex',
    },
    geometry: {
      kind: 'marker',
      position: [1, 0, 0],
      displayRadius: 0.25,
    },
  }

  function createBoundMesh(renderable: RenderableEntityRecord) {
    const geometry = new THREE.BufferGeometry()
    if (renderable.geometry.kind !== 'mesh') {
      throw new Error('Expected mesh renderable.')
    }

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(renderable.geometry.vertexPositions.flat(), 3),
    )
    geometry.setIndex(renderable.geometry.triangleIndices.flat())
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(renderable.geometry.vertexNormals?.flat() ?? [0, 0, 1], 3),
    )

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    bindRenderableObject(
      mesh,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      'document',
      renderable,
    )
    return mesh
  }

  function createBoundLine(renderable: RenderableEntityRecord) {
    if (renderable.geometry.kind !== 'polyline') {
      throw new Error('Expected polyline renderable.')
    }

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        renderable.geometry.points.map((point) => new THREE.Vector3(point[0], point[1], point[2])),
      ),
      new THREE.LineBasicMaterial(),
    )
    bindRenderableObject(
      line,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      'document',
      renderable,
    )
    return line
  }

  function createBoundMarker(renderable: RenderableEntityRecord) {
    if (renderable.geometry.kind !== 'marker') {
      throw new Error('Expected marker renderable.')
    }

    const group = new THREE.Group()
    const visibleMesh = new THREE.Mesh(
      MARKER_SPHERE_GEOMETRY,
      new THREE.MeshStandardMaterial(),
    )
    visibleMesh.position.set(...renderable.geometry.position)
    visibleMesh.scale.setScalar(getVisibleMarkerRadius(renderable.geometry.displayRadius))

    const pickProxy = createMarkerPickProxy(renderable.geometry.position, renderable.geometry.displayRadius)
    pickProxy.userData.highlightExcluded = true

    group.add(visibleMesh)
    group.add(pickProxy)
    bindRenderableObject(
      group,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      'document',
      renderable,
    )

    return { group, visibleMesh, pickProxy }
  }

  function createIntersection(object: THREE.Object3D, distance: number) {
    return {
      distance,
      object,
    } as THREE.Intersection<THREE.Object3D>
  }

  function createBoundObject(renderable: RenderableEntityRecord) {
    const object = new THREE.Object3D()
    bindRenderableObject(
      object,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      'document',
      renderable,
    )
    return object
  }

  {
    const faceMesh = createBoundMesh(faceRenderable)
    const edgeLine = createBoundLine(edgeRenderable)

    const resolved = resolvePickTarget([
      createIntersection(edgeLine, 0.805),
      createIntersection(faceMesh, 0.8),
    ])

    assertDeepEqual(
      resolved?.target,
      faceRenderable.binding.target,
      'Closer faces must win when they are nearer than competing edges.',
    )
  }

  {
    const faceMesh = createBoundMesh(faceRenderable)
    const edgeLine = createBoundLine(edgeRenderable)

    const resolved = resolvePickTarget([
      createIntersection(edgeLine, 1.1),
      createIntersection(faceMesh, 0.8),
    ])

    assertDeepEqual(
      resolved?.target,
      faceRenderable.binding.target,
      'Faces must win when the edge is clearly occluded behind them.',
    )
  }

  {
    const faceMesh = createBoundMesh(faceRenderable)
    const edgeLine = createBoundLine(edgeRenderable)

    const resolved = resolvePickTarget([
      createIntersection(faceMesh, 1),
      createIntersection(edgeLine, 1),
    ])

    assertDeepEqual(
      resolved?.target,
      edgeRenderable.binding.target,
      'Equal-distance ties must still prefer lower pickPriority.',
    )
  }

  {
    const constructionRenderable: RenderableEntityRecord = {
      id: 'renderable_construction_plane',
      label: 'XY Plane',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_construction_plane',
        pickPriority: 5,
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
        topology: null,
        semanticClass: 'construction',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
        vertexNormals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        triangleIndices: [[0, 1, 2]],
      },
    }
    const sketchRenderable: RenderableEntityRecord = {
      id: 'renderable_sketch_curve',
      label: 'Sketch curve',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_sketch_curve',
        pickPriority: 12,
        target: { kind: 'sketchEntity', sketchId: 'sketch_a', entityId: 'sketch_entity_a' },
        topology: null,
        semanticClass: 'sketchCurve',
      },
      geometry: {
        kind: 'polyline',
        points: [[0, 0, 0], [2, 0, 0]],
        isClosed: false,
      },
    }
    const construction = createBoundObject(constructionRenderable)
    const sketch = createBoundObject(sketchRenderable)

    const resolved = resolvePickTarget([
      createIntersection(construction, 1),
      createIntersection(sketch, 1.003),
    ])

    assertDeepEqual(
      resolved?.target,
      sketchRenderable.binding.target,
      'Coplanar sketch curves must beat construction planes even when the plane has a slightly nearer ray hit.',
    )
  }

  {
    const constructionRenderable: RenderableEntityRecord = {
      id: 'renderable_construction_plane_region',
      label: 'XY Plane',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_construction_plane_region',
        pickPriority: 5,
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
        topology: null,
        semanticClass: 'construction',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
        vertexNormals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        triangleIndices: [[0, 1, 2]],
      },
    }
    const regionRenderable: RenderableEntityRecord = {
      id: 'renderable_region',
      label: 'Region',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_region',
        pickPriority: 8,
        target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' },
        topology: null,
        semanticClass: 'region',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
        vertexNormals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        triangleIndices: [[0, 1, 2]],
      },
    }
    const construction = createBoundObject(constructionRenderable)
    const region = createBoundObject(regionRenderable)

    const resolved = resolvePickTarget([
      createIntersection(construction, 1),
      createIntersection(region, 1.003),
    ])

    assertDeepEqual(
      resolved?.target,
      regionRenderable.binding.target,
      'Coplanar regions must beat construction planes within same-layer tolerance.',
    )
  }

  {
    const regionRenderable: RenderableEntityRecord = {
      id: 'renderable_region_boundary',
      label: 'Region',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_region_boundary',
        pickPriority: 8,
        target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' },
        topology: null,
        semanticClass: 'region',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
        vertexNormals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        triangleIndices: [[0, 1, 2]],
      },
    }
    const sketchRenderable: RenderableEntityRecord = {
      id: 'renderable_sketch_curve_boundary',
      label: 'Sketch curve',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_sketch_curve_boundary',
        pickPriority: 12,
        target: { kind: 'sketchEntity', sketchId: 'sketch_a', entityId: 'sketch_entity_a' },
        topology: null,
        semanticClass: 'sketchCurve',
      },
      geometry: {
        kind: 'polyline',
        points: [[0, 0, 0], [2, 0, 0]],
        isClosed: false,
      },
    }
    const region = createBoundObject(regionRenderable)
    const sketch = createBoundObject(sketchRenderable)
    const intersections = [
      createIntersection(region, 1),
      createIntersection(sketch, 1),
    ]

    const curveResolved = resolvePickTarget(intersections)
    assertDeepEqual(
      curveResolved?.target,
      sketchRenderable.binding.target,
      'Sketch curves must beat filled regions at the same apparent depth.',
    )

    const regionResolved = resolvePickTarget(
      intersections,
      (target) => target.kind === 'region',
    )
    assertDeepEqual(
      regionResolved?.target,
      regionRenderable.binding.target,
      'Active selection filters must allow region picking when overlapping curves are rejected.',
    )
  }

  {
    const firstRegionRenderable: RenderableEntityRecord = {
      id: 'renderable_region_a',
      label: 'Region A',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_region_a',
        pickPriority: 8,
        target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' },
        topology: null,
        semanticClass: 'region',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
        vertexNormals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
        triangleIndices: [[0, 1, 2]],
      },
    }
    const secondRegionRenderable: RenderableEntityRecord = {
      ...firstRegionRenderable,
      id: 'renderable_region_b',
      label: 'Region B',
      binding: {
        ...firstRegionRenderable.binding,
        pickId: 'pick_region_b',
        target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_b' },
      },
    }
    const first = createBoundObject(firstRegionRenderable)
    const second = createBoundObject(secondRegionRenderable)

    const forward = resolvePickTarget([
      createIntersection(first, 1),
      createIntersection(second, 1),
    ])
    const reverse = resolvePickTarget([
      createIntersection(second, 1),
      createIntersection(first, 1),
    ])

    assertDeepEqual(
      forward?.target,
      reverse?.target,
      'Equal candidates must resolve to the same target regardless of raycaster hit order.',
    )
  }

  {
    const sketchTarget: PrimitiveRef = { kind: 'sketchEntity', sketchId: 'sketch_a', entityId: 'sketch_entity_1' }
    const sketchLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]),
      new THREE.LineBasicMaterial(),
    )
    bindRenderableObject(sketchLine, null, sketchTarget, 'sketchCurve', 'document')

    const resolved = resolvePickTarget([createIntersection(sketchLine, 0.25)])

    assertDeepEqual(
      resolved?.target,
      sketchTarget,
      'Sketch display targets must resolve through the same resolver without a renderable record.',
    )
    assertEqual(resolved?.pickId ?? null, null, 'Sketch display hits should not require a pickId.')
  }

  {
    const marker = createBoundMarker(vertexRenderable)
    const root = new THREE.Group()
    root.add(marker.group)

    const bindings = collectBindings(root)
    assert(bindings !== null, 'collectBindings must return a result for populated roots.')
    assert(
      bindings.pickables.includes(marker.group),
      'collectBindings must include marker group roots as pickables.',
    )

    const objects = bindings.targetToObjects.get('vertex:body_a:vertex_top_right') ?? []
    assertEqual(objects.length, 1, 'Only the visible marker mesh should be highlightable.')
    assertEqual(objects[0], marker.visibleMesh, 'The visible mesh must be stored in targetToObjects.')
  }

  {
    const marker = createBoundMarker(vertexRenderable)
    const root = new THREE.Group()
    root.add(marker.group)

    const bindings = collectBindings(root)
    assert(bindings !== null)

    updateWorkspaceHighlight(bindings.targetToObjects, [vertexRenderable.binding.target], null)

    assert(marker.visibleMesh.material instanceof THREE.MeshStandardMaterial)
    assertEqual(
      marker.visibleMesh.material.color.getHex(),
      0xf4fbff,
      'Selected marker mesh must receive the selected wire color.',
    )
    assert(marker.pickProxy.material instanceof THREE.MeshBasicMaterial)
    assertEqual(marker.pickProxy.material.opacity, 0, 'Marker pick proxy must remain invisible.')
  }

  {
    const invisible = createInvisiblePickMaterial()
    assertEqual(invisible.opacity, 0, 'Invisible pick material must stay fully transparent.')
    assertEqual(invisible.colorWrite, false, 'Invisible pick material must not write color.')
  }

  {
    assertEqual(DEFAULT_LINE_PICK_THRESHOLD, 0.75, 'Line picking must use the stable default threshold.')
  }

  console.log('All render-picking tests passed.')
})

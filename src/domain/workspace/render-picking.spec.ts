import { test } from 'bun:test'
import * as THREE from 'three'

import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  MARKER_SPHERE_GEOMETRY,
  GEOMETRY_HIGHLIGHT_COLORS,
  DEFAULT_LINE_PICK_THRESHOLD,
  bindFaceHoverPerimeterObject,
  collectRaycastPickCandidates,
  bindRenderableObject,
  collectBindings,
  createMeshBoundaryLineSegmentsGeometry,
  createInvisiblePickMaterial,
  createMarkerPickProxy,
  createRenderableLineMaterial,
  createRenderableMeshMaterial,
  createProjectedPickCandidate,
  getVisibleMarkerRadius,
  resolveAllCandidates,
  resolvePickTarget,
  shouldIncludeProjectedPickCandidate,
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

  function createFacePerimeterLine(renderable: RenderableEntityRecord) {
    if (renderable.geometry.kind !== 'mesh') {
      throw new Error('Expected mesh renderable.')
    }

    if (renderable.binding.semanticClass !== 'bodyFace' && renderable.binding.semanticClass !== 'planarFace') {
      throw new Error('Expected face renderable.')
    }

    const line = new THREE.LineSegments(
      createMeshBoundaryLineSegmentsGeometry(renderable.geometry),
      new THREE.LineBasicMaterial({
        color: GEOMETRY_HIGHLIGHT_COLORS.hover,
        transparent: true,
        opacity: 0,
      }),
    )
    bindFaceHoverPerimeterObject(
      line,
      renderable.binding.target,
      renderable.binding.semanticClass,
      'document',
    )
    return line
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

    // This is intentionally beyond the inclusive face/wire occlusion tolerance;
    // wires inside that tolerance are treated as pickable at the face boundary.
    const resolved = resolvePickTarget([
      createIntersection(edgeLine, 0.811),
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

    const faceResolved = resolvePickTarget(
      [createIntersection(faceMesh, 0.5)],
      (target) => target.kind === 'face',
    )
    assertDeepEqual(
      faceResolved?.target,
      faceRenderable.binding.target,
      'Face filters must keep selecting the exact face hit.',
    )

    const bodyResolved = resolvePickTarget(
      [createIntersection(faceMesh, 0.5)],
      (target) => target.kind === 'body',
    )
    assertDeepEqual(
      bodyResolved?.target,
      { kind: 'body', bodyId: 'body_a' },
      'Body filters must resolve a face hit to the owning body.',
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
    const sketchTarget: PrimitiveRef = { kind: 'sketchEntity', sketchId: 'sketch_a', entityId: 'sketch_entity_styled' }
    const material = new THREE.LineBasicMaterial({
      color: 0x33ffaa,
      transparent: true,
      opacity: 0.5,
    })
    const sketchLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]),
      material,
    )
    const root = new THREE.Group()
    root.add(sketchLine)
    bindRenderableObject(sketchLine, null, sketchTarget, 'sketchCurve', 'document')

    const bindings = collectBindings(root)
    assert(bindings !== null)

    updateWorkspaceHighlight(bindings.targetToObjects, [], sketchTarget)
    assertEqual(material.color.getHex(), GEOMETRY_HIGHLIGHT_COLORS.hover, 'Hovered styled sketch lines should still receive hover highlight.')
    assertEqual(material.opacity, 0.98, 'Hovered styled sketch lines should still receive hover opacity.')

    updateWorkspaceHighlight(bindings.targetToObjects, [], null)
    assertEqual(material.color.getHex(), 0x33ffaa, 'Inactive styled sketch lines should restore authored color after hover.')
    assertEqual(material.opacity, 0.5, 'Inactive styled sketch lines should restore authored opacity after hover.')

    updateWorkspaceHighlight(bindings.targetToObjects, [sketchTarget], null)
    assertEqual(material.color.getHex(), GEOMETRY_HIGHLIGHT_COLORS.selected, 'Selected styled sketch lines should still receive selected highlight.')

    updateWorkspaceHighlight(bindings.targetToObjects, [], null)
    assertEqual(material.color.getHex(), 0x33ffaa, 'Inactive styled sketch lines should restore authored color after selection.')

    sketchLine.geometry.dispose()
    material.dispose()
  }

  {
    const material = createRenderableLineMaterial(edgeRenderable, 'document')
    assertEqual(material.depthTest, true, 'Committed edges should still depth-test against nearer faces.')
    assertEqual(material.depthWrite, false, 'Committed edges must not write depth and destabilize coplanar wires.')
    material.dispose()
  }

  {
    const faceMesh = createBoundMesh(faceRenderable)
    const facePerimeter = createFacePerimeterLine(faceRenderable)
    const root = new THREE.Group()
    root.add(faceMesh)
    root.add(facePerimeter)

    const bindings = collectBindings(root)
    assert(bindings !== null)

    assert(!bindings.pickables.includes(facePerimeter), 'Face hover perimeter overlays must not be pickable.')

    assert(faceMesh.material instanceof THREE.MeshStandardMaterial)
    assert(facePerimeter.material instanceof THREE.LineBasicMaterial)
    const baselineFaceColor = faceMesh.material.color.getHex()

    updateWorkspaceHighlight(bindings.targetToObjects, [], faceRenderable.binding.target)

    assertEqual(
      faceMesh.material.color.getHex(),
      baselineFaceColor,
      'Hovered face meshes must keep their surface color.',
    )
    assertEqual(
      facePerimeter.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.hover,
      'Hovered face perimeter overlays must receive the hover color.',
    )
    assertEqual(facePerimeter.material.opacity, 0.98, 'Hovered face perimeter overlays must become visible.')

    updateWorkspaceHighlight(bindings.targetToObjects, [faceRenderable.binding.target], faceRenderable.binding.target)

    assertEqual(
      faceMesh.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      'Selected face meshes must keep whole-face selected coloring.',
    )
    assertEqual(facePerimeter.material.opacity, 0, 'Selected face perimeter overlays must stay hidden.')
  }

  {
    const faceMesh = createBoundMesh(faceRenderable)
    const edgeLine = createBoundLine(edgeRenderable)
    const root = new THREE.Group()
    root.add(faceMesh)
    root.add(edgeLine)

    const bindings = collectBindings(root)
    assert(bindings !== null)

    updateWorkspaceHighlight(bindings.targetToObjects, [{ kind: 'body', bodyId: 'body_a' }], null)

    assert(faceMesh.material instanceof THREE.MeshStandardMaterial)
    assertEqual(
      faceMesh.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      'Selected body targets must highlight owned face renderables.',
    )
    assert(edgeLine.material instanceof THREE.LineBasicMaterial)
    assertEqual(
      edgeLine.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      'Selected body targets must highlight owned edge renderables.',
    )
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
      GEOMETRY_HIGHLIGHT_COLORS.selected,
      'Selected marker mesh must receive the selected wire color.',
    )
    assert(marker.pickProxy.material instanceof THREE.MeshBasicMaterial)
    assertEqual(marker.pickProxy.material.opacity, 0, 'Marker pick proxy must remain invisible.')
  }

  {
    const marker = createBoundMarker(vertexRenderable)
    const root = new THREE.Group()
    root.add(marker.group)

    const bindings = collectBindings(root)
    assert(bindings !== null)

    updateWorkspaceHighlight(bindings.targetToObjects, [], null, [vertexRenderable.binding.target])

    assert(marker.visibleMesh.material instanceof THREE.MeshStandardMaterial)
    assertEqual(
      marker.visibleMesh.material.color.getHex(),
      GEOMETRY_HIGHLIGHT_COLORS.hover,
      'Annotation-related geometry must receive hover highlight without becoming selected.',
    )
  }

  {
    const boundaryGeometry = createMeshBoundaryLineSegmentsGeometry(faceRenderable.geometry)
    const position = boundaryGeometry.getAttribute('position')
    assertEqual(position.count, 8, 'Two triangle quad meshes should produce four boundary line segments.')

    const segmentKeys = new Set<string>()
    for (let index = 0; index < position.count; index += 2) {
      const start = `${position.getX(index)},${position.getY(index)},${position.getZ(index)}`
      const end = `${position.getX(index + 1)},${position.getY(index + 1)},${position.getZ(index + 1)}`
      segmentKeys.add(start < end ? `${start}|${end}` : `${end}|${start}`)
    }

    assert(!segmentKeys.has('0,0,0|1,1,0'), 'Face perimeter extraction must exclude internal triangulation diagonals.')
    boundaryGeometry.dispose()
  }

  {
    const invisible = createInvisiblePickMaterial()
    assertEqual(invisible.opacity, 0, 'Invisible pick material must stay fully transparent.')
    assertEqual(invisible.colorWrite, false, 'Invisible pick material must not write color.')
  }

  {
    assertEqual(DEFAULT_LINE_PICK_THRESHOLD, 0.75, 'Line picking must use the stable default threshold.')
  }

  {
    const regionRenderable: RenderableEntityRecord = {
      id: 'renderable_region_material_offset',
      label: 'Region',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_region_material_offset',
        pickPriority: 8,
        target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_material_offset' },
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
    const material = createRenderableMeshMaterial(regionRenderable, 'document')
    assert(
      material.polygonOffsetFactor < 0 && material.polygonOffsetUnits < 0,
      'Committed sketch regions should be biased toward the camera to avoid coplanar depth flicker.',
    )
    material.dispose()
  }

  {
    const faceMesh = createBoundMesh(faceRenderable)
    const projectedVertex = createProjectedPickCandidate({
      pickId: vertexRenderable.binding.pickId,
      target: vertexRenderable.binding.target,
      renderable: vertexRenderable,
      semanticClass: 'featureVertex',
      priority: vertexRenderable.binding.pickPriority,
      screenDistance: 40,
      depth: 0.4,
    })

    const resolved = resolveAllCandidates([
      ...collectRaycastPickCandidates([createIntersection(faceMesh, 0.5)]),
      projectedVertex,
    ])

    assertDeepEqual(
      resolved?.target,
      vertexRenderable.binding.target,
      'Unified picking must prefer an in-radius projected vertex over a raycast face.',
    )
  }

  {
    const edgeLine = createBoundLine(edgeRenderable)
    const projectedEdge = createProjectedPickCandidate({
      pickId: 'projected_edge',
      target: { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_projected' },
      semanticClass: 'featureEdge',
      screenDistance: 1,
      depth: 0,
      stableKey: 'projected:edge',
    })

    const resolved = resolveAllCandidates([
      projectedEdge,
      ...collectRaycastPickCandidates([createIntersection(edgeLine, 0.5)]),
    ])

    assertDeepEqual(
      resolved?.target,
      edgeRenderable.binding.target,
      'Projected non-point candidates must not displace same-rank raycast hits.',
    )
  }

  {
    const currentHover = vertexRenderable.binding.target

    assertEqual(
      shouldIncludeProjectedPickCandidate({
        target: currentHover,
        currentHoverTarget: currentHover,
        screenDistance: 50,
      }),
      true,
      'Current hover must remain active inside the projected-point exit radius.',
    )
    assertDeepEqual(
      resolveAllCandidates([
        createProjectedPickCandidate({
          pickId: vertexRenderable.binding.pickId,
          target: currentHover,
          renderable: vertexRenderable,
          semanticClass: 'featureVertex',
          screenDistance: 50,
          depth: 0,
        }),
      ])?.target,
      currentHover,
      'A hysteresis-retained projected candidate must still resolve to the current target.',
    )
    assertEqual(
      shouldIncludeProjectedPickCandidate({
        target: currentHover,
        currentHoverTarget: currentHover,
        screenDistance: 60,
      }),
      false,
      'Current hover must clear beyond the projected-point exit radius.',
    )
  }

  {
    const faceMesh = createBoundMesh(faceRenderable)
    const edgeLine = createBoundLine(edgeRenderable)

    const atBoundary = resolvePickTarget([
      createIntersection(faceMesh, 1),
      createIntersection(edgeLine, 1.01),
    ])
    assertDeepEqual(
      atBoundary?.target,
      edgeRenderable.binding.target,
      'Wires exactly at the occlusion tolerance behind a face must remain pickable.',
    )

    const beyondBoundary = resolvePickTarget([
      createIntersection(faceMesh, 1),
      createIntersection(edgeLine, 1.011),
    ])
    assertDeepEqual(
      beyondBoundary?.target,
      faceRenderable.binding.target,
      'Wires beyond the occlusion tolerance must be occluded by the face.',
    )
  }

  {
    const constructionRenderable: RenderableEntityRecord = {
      id: 'renderable_construction_boundary',
      label: 'XY Plane',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_construction_boundary',
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
      id: 'renderable_region_same_layer_boundary',
      label: 'Region',
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: 'pick_region_same_layer_boundary',
        pickPriority: 8,
        target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_boundary' },
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

    assertDeepEqual(
      resolvePickTarget([
        createIntersection(construction, 1),
        createIntersection(region, 1.003),
      ])?.target,
      regionRenderable.binding.target,
      'Same-layer tolerance must prefer the higher-ranked candidate at 0.003.',
    )
    assertDeepEqual(
      resolvePickTarget([
        createIntersection(construction, 1),
        createIntersection(region, 1.004),
      ])?.target,
      regionRenderable.binding.target,
      'Same-layer tolerance must be inclusive at exactly 0.004.',
    )
    assertDeepEqual(
      resolvePickTarget([
        createIntersection(construction, 1),
        createIntersection(region, 1.005),
      ])?.target,
      constructionRenderable.binding.target,
      'Same-layer tolerance must switch to depth ordering beyond 0.004.',
    )
  }

  {
    const nearRenderable: RenderableEntityRecord = {
      ...vertexRenderable,
      id: 'renderable_duplicate_near',
      binding: {
        ...vertexRenderable.binding,
        pickId: 'pick_duplicate_vertex',
        target: { kind: 'vertex', bodyId: 'body_a', vertexId: 'vertex_duplicate_near' },
      },
    }
    const farRenderable: RenderableEntityRecord = {
      ...vertexRenderable,
      id: 'renderable_duplicate_far',
      binding: {
        ...vertexRenderable.binding,
        pickId: 'pick_duplicate_vertex',
        target: { kind: 'vertex', bodyId: 'body_a', vertexId: 'vertex_duplicate_far' },
      },
    }
    const near = createBoundObject(nearRenderable)
    const far = createBoundObject(farRenderable)

    const forward = resolvePickTarget([
      createIntersection(far, 2),
      createIntersection(near, 1),
    ])
    const reverse = resolvePickTarget([
      createIntersection(near, 1),
      createIntersection(far, 2),
    ])

    assertDeepEqual(
      forward?.target,
      nearRenderable.binding.target,
      'Duplicate pickIds must keep the nearest sorted candidate, not the first input candidate.',
    )
    assertDeepEqual(
      reverse?.target,
      nearRenderable.binding.target,
      'Duplicate pickId filtering must be stable regardless of input order.',
    )
  }

  {
    const rejected = createProjectedPickCandidate({
      pickId: vertexRenderable.binding.pickId,
      target: vertexRenderable.binding.target,
      renderable: vertexRenderable,
      semanticClass: 'featureVertex',
      screenDistance: 4,
      depth: 0,
    })
    const accepted = createProjectedPickCandidate({
      pickId: edgeRenderable.binding.pickId,
      target: edgeRenderable.binding.target,
      renderable: edgeRenderable,
      semanticClass: 'featureEdge',
      screenDistance: 6,
      depth: 0,
    })

    const resolved = resolveAllCandidates(
      [rejected, accepted],
      (target) => target.kind === 'edge',
    )

    assertDeepEqual(
      resolved?.target,
      edgeRenderable.binding.target,
      'Rejected high-priority candidates must not prevent the next acceptable candidate from resolving.',
    )
  }

  console.log('All render-picking tests passed.')
})

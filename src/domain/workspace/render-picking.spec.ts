import * as THREE from 'three'

import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  MARKER_SPHERE_GEOMETRY,
  bindRenderableObject,
  collectBindings,
  createInvisiblePickMaterial,
  createMarkerPickProxy,
  createRenderableLineMaterial,
  createRenderableMarkerMaterial,
  createRenderableMeshMaterial,
  getBoundTarget,
  getVisibleMarkerRadius,
  getRenderableRenderOrder,
  isSeededDatumPlaneRenderable,
  isBvhAcceleratedDocumentRenderable,
  partitionViewportRenderablesForBvh,
  resolvePickTarget,
  updateWorkspaceHighlight,
} from '@/domain/workspace/render-picking'
import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertEqual<T>(actual: T, expected: T, message = 'Expected values to match') {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`)
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message = 'Expected values to match deeply') {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)

  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, received ${actualJson}`)
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const datumPlaneRenderable: RenderableEntityRecord = {
  id: 'renderable_construction_xy_surface',
  label: 'XY Plane',
  ownerBodyId: null,
  ownerFeatureId: null,
  binding: {
    pickId: 'pick_construction_xy_surface',
    pickPriority: 10,
    target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    topology: null,
    semanticClass: 'construction',
  },
  geometry: {
    kind: 'mesh',
    vertexPositions: [
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
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

const solidFaceRenderable: RenderableEntityRecord = {
  id: 'renderable_solid_face',
  label: 'Solid face',
  ownerBodyId: 'body_a',
  ownerFeatureId: null,
  binding: {
    pickId: 'pick_solid_face',
    pickPriority: 10,
    target: { kind: 'face', bodyId: 'body_a', faceId: 'face_a' },
    topology: 'face',
    semanticClass: 'bodyFace',
  },
  geometry: {
    kind: 'mesh',
    vertexPositions: [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
    ],
    vertexNormals: [
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
    ],
    triangleIndices: [[0, 1, 2]],
  },
}

const planarFaceRenderable: RenderableEntityRecord = {
  id: 'renderable_planar_face',
  label: 'Planar face',
  ownerBodyId: 'body_plane',
  ownerFeatureId: null,
  binding: {
    pickId: 'pick_planar_face',
    pickPriority: 10,
    target: { kind: 'face', bodyId: 'body_plane', faceId: 'face_plane' },
    topology: 'face',
    semanticClass: 'planarFace',
  },
  geometry: solidFaceRenderable.geometry,
}

const regionRenderable: RenderableEntityRecord = {
  id: 'renderable_region',
  label: 'Region',
  ownerBodyId: null,
  ownerFeatureId: 'feature_region',
  binding: {
    pickId: 'pick_region',
    pickPriority: 12,
    target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_a' },
    topology: null,
    semanticClass: 'region',
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
}

const durableEdgeRenderable: RenderableEntityRecord = {
  id: 'renderable_edge',
  label: 'Edge',
  ownerBodyId: 'body_a',
  ownerFeatureId: null,
  binding: {
    pickId: 'pick_edge',
    pickPriority: 1,
    target: { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_a' },
    topology: 'edge',
    semanticClass: 'featureEdge',
  },
  geometry: {
    kind: 'polyline',
    points: [
      [0, 0, 0],
      [2, 0, 0],
    ],
    isClosed: false,
  },
}

const durableMarkerRenderable: RenderableEntityRecord = {
  id: 'renderable_vertex_marker',
  label: 'Vertex marker',
  ownerBodyId: 'body_a',
  ownerFeatureId: null,
  binding: {
    pickId: 'pick_vertex_marker',
    pickPriority: 2,
    target: { kind: 'vertex', bodyId: 'body_a', vertexId: 'vertex_a' },
    topology: 'vertex',
    semanticClass: 'featureVertex',
  },
  geometry: {
    kind: 'marker',
    position: [2, 3, 4],
    displayRadius: 0.25,
  },
}

const sketchDisplayMarker: SketchSessionDisplayRenderable = {
  id: 'renderable_display_marker',
  label: 'Display marker',
  target: { kind: 'sketchPoint', sketchId: 'sketch_a', pointId: 'sketch_point_a' },
  geometry: {
    kind: 'marker' as const,
    position: [5, 6, 7] as const,
    displayRadius: 0.125,
  },
}

const sketchDisplayLine: SketchSessionDisplayRenderable = {
  id: 'renderable_display_line',
  label: 'Display line',
  target: { kind: 'sketchEntity', sketchId: 'sketch_a', entityId: 'sketch_entity_a' },
  geometry: {
    kind: 'polyline' as const,
    points: [
      [0, 0, 0] as const,
      [4, 0, 0] as const,
    ],
    isClosed: false,
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asDocument(renderable: RenderableEntityRecord): ViewportRenderableRecord {
  return { origin: 'document', renderable }
}

function asPreview(renderable: RenderableEntityRecord): ViewportRenderableRecord {
  return { origin: 'preview', renderable }
}

function createIntersection(
  object: THREE.Object3D,
  distance: number,
): THREE.Intersection<THREE.Object3D> {
  return {
    distance,
    object,
    point: new THREE.Vector3(),
  } as unknown as THREE.Intersection<THREE.Object3D>
}

function createRaycaster(origin: readonly [number, number, number], direction: readonly [number, number, number]) {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(origin[0], origin[1], origin[2]),
    new THREE.Vector3(direction[0], direction[1], direction[2]).normalize(),
  )

  raycaster.params.Line.threshold = 0.75
  return raycaster
}

// ---------------------------------------------------------------------------
// R3F-faithful scene builders
//
// These replicate the exact Three.js object hierarchy that the React Three
// Fiber components (DocumentMeshNode, DocumentPolylineNode, DocumentMarkerNode)
// produce at runtime, including the <Bvh> wrapper group for accelerated meshes.
// ---------------------------------------------------------------------------

function buildR3FMeshObject(entry: ViewportRenderableRecord): THREE.Mesh {
  const renderable = entry.renderable
  const geometryData = renderable.geometry.kind === 'mesh' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Renderable ${renderable.id} is missing mesh geometry.`)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(geometryData.vertexPositions.flat(), 3),
  )
  geometry.setIndex(geometryData.triangleIndices.flat())
  if (geometryData.vertexNormals) {
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(geometryData.vertexNormals.flat(), 3),
    )
  } else {
    geometry.computeVertexNormals()
  }

  const material = isSeededDatumPlaneRenderable(renderable)
    ? new THREE.MeshStandardMaterial({
        color: 0x9ea8b5,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        metalness: 0.02,
        roughness: 0.96,
        emissive: 0x000000,
        emissiveIntensity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
    : createRenderableMeshMaterial(renderable, entry.origin)

  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = isSeededDatumPlaneRenderable(renderable)
    ? 1
    : getRenderableRenderOrder(renderable, entry.origin)

  // Matches DocumentMeshNode ref callback
  bindRenderableObject(
    mesh,
    renderable.binding.pickId,
    renderable.binding.target,
    renderable.binding.semanticClass,
    entry.origin,
    renderable,
  )

  return mesh
}

function buildR3FPolylineObject(entry: ViewportRenderableRecord): THREE.Line {
  const renderable = entry.renderable
  const geometryData = renderable.geometry.kind === 'polyline' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Renderable ${renderable.id} is missing polyline geometry.`)
  }

  const points = geometryData.points.map((point) => new THREE.Vector3(point[0], point[1], point[2]))
  const displayPoints = geometryData.isClosed && points.length > 0 ? [...points, points[0].clone()] : points
  const geometry = new THREE.BufferGeometry().setFromPoints(displayPoints)
  const material = isSeededDatumPlaneRenderable(renderable)
    ? new THREE.LineBasicMaterial({
        color: 0x7f8a98,
        transparent: true,
        opacity: 0.4,
        depthTest: true,
        depthWrite: false,
      })
    : createRenderableLineMaterial(renderable, entry.origin)
  material.depthTest = true
  material.depthWrite = false

  const line = new THREE.Line(geometry, material)
  line.renderOrder = isSeededDatumPlaneRenderable(renderable)
    ? 2
    : getRenderableRenderOrder(renderable, entry.origin)

  // Matches DocumentPolylineNode useMemo: binding set on the line before <primitive>
  bindRenderableObject(
    line,
    renderable.binding.pickId,
    renderable.binding.target,
    renderable.binding.semanticClass,
    entry.origin,
    renderable,
  )

  return line
}

function buildR3FMarkerObject(entry: ViewportRenderableRecord): THREE.Group {
  const renderable = entry.renderable
  const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Renderable ${renderable.id} is missing marker geometry.`)
  }

  const material = createRenderableMarkerMaterial(renderable, entry.origin)
  const mesh = new THREE.Mesh(MARKER_SPHERE_GEOMETRY, material)
  mesh.position.set(geometryData.position[0], geometryData.position[1], geometryData.position[2])
  mesh.scale.setScalar(getVisibleMarkerRadius(geometryData.displayRadius))
  mesh.renderOrder = getRenderableRenderOrder(renderable, entry.origin)
  mesh.material.depthTest = true
  mesh.material.depthWrite = false

  const pickProxy = createMarkerPickProxy(geometryData.position, geometryData.displayRadius)
  pickProxy.userData.highlightExcluded = true

  const group = new THREE.Group()
  group.add(mesh)
  group.add(pickProxy)

  // Matches DocumentMarkerNode ref callback: binding on the group
  bindRenderableObject(
    group,
    renderable.binding.pickId,
    renderable.binding.target,
    renderable.binding.semanticClass,
    entry.origin,
    renderable,
  )

  return group
}

function buildR3FSketchPolylineObject(renderable: SketchSessionDisplayRenderable): THREE.Line {
  const geometryData = renderable.geometry.kind === 'polyline' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Display renderable ${renderable.id} is missing polyline geometry.`)
  }

  const points = geometryData.points.map((point) => new THREE.Vector3(point[0], point[1], point[2]))
  const displayPoints = geometryData.isClosed && points.length > 0 ? [...points, points[0].clone()] : points
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(displayPoints),
    new THREE.LineBasicMaterial({
      color: 0x8db7d6,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    }),
  )
  line.renderOrder = 3

  if (renderable.target) {
    bindRenderableObject(line, null, renderable.target, 'sketchCurve', 'document')
  }

  return line
}

function buildR3FSketchMarkerObject(renderable: SketchSessionDisplayRenderable): THREE.Group {
  const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Display renderable ${renderable.id} is missing marker geometry.`)
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0x8db7d6,
    metalness: 0.08,
    roughness: 0.34,
    emissive: 0x1c3245,
    emissiveIntensity: 0.16,
    depthTest: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(MARKER_SPHERE_GEOMETRY, material)
  mesh.position.set(geometryData.position[0], geometryData.position[1], geometryData.position[2])
  mesh.scale.setScalar(getVisibleMarkerRadius(geometryData.displayRadius))
  mesh.renderOrder = 4
  mesh.material.depthTest = true
  mesh.material.depthWrite = false

  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 16),
    createInvisiblePickMaterial(),
  )
  proxy.position.set(geometryData.position[0], geometryData.position[1], geometryData.position[2])
  proxy.scale.setScalar(Math.max(geometryData.displayRadius * 1.45, geometryData.displayRadius, Number.EPSILON))
  proxy.userData.highlightExcluded = true

  const group = new THREE.Group()
  group.add(mesh)
  group.add(proxy)

  if (renderable.target) {
    bindRenderableObject(group, null, renderable.target, 'sketchPoint', 'document')
  }

  return group
}

/**
 * Build a document scene that matches the R3F viewport's actual Three.js hierarchy:
 *
 *   documentGroup
 *     └─ bvhWrapperGroup (simulates <Bvh>)
 *         └─ accelerated meshes
 *     ├─ fallback polylines
 *     └─ fallback marker groups
 */
function buildR3FDocumentScene(renderables: ViewportRenderableRecord[]) {
  const documentGroup = new THREE.Group()
  const partition = partitionViewportRenderablesForBvh(renderables)

  // BVH wrapper group — simulates the <Bvh> drei component
  const bvhWrapperGroup = new THREE.Group()
  documentGroup.add(bvhWrapperGroup)

  for (const entry of partition.accelerated) {
    switch (entry.renderable.geometry.kind) {
      case 'mesh':
        bvhWrapperGroup.add(buildR3FMeshObject(entry))
        break
      case 'polyline':
        bvhWrapperGroup.add(buildR3FPolylineObject(entry))
        break
      case 'marker':
        bvhWrapperGroup.add(buildR3FMarkerObject(entry))
        break
    }
  }

  for (const entry of partition.fallback) {
    switch (entry.renderable.geometry.kind) {
      case 'mesh':
        documentGroup.add(buildR3FMeshObject(entry))
        break
      case 'polyline':
        documentGroup.add(buildR3FPolylineObject(entry))
        break
      case 'marker':
        documentGroup.add(buildR3FMarkerObject(entry))
        break
    }
  }

  documentGroup.updateMatrixWorld(true)
  return documentGroup
}

function buildR3FSketchScene(renderables: SketchSessionDisplayRenderable[]) {
  const sketchGroup = new THREE.Group()

  for (const renderable of renderables) {
    switch (renderable.geometry.kind) {
      case 'polyline':
        sketchGroup.add(buildR3FSketchPolylineObject(renderable))
        break
      case 'marker':
        sketchGroup.add(buildR3FSketchMarkerObject(renderable))
        break
      case 'mesh':
        // Sketch mesh display not tested here (covered by buildSketchDisplayGroup)
        break
    }
  }

  sketchGroup.updateMatrixWorld(true)
  return sketchGroup
}

/**
 * Full R3F picking pipeline: build scene → collect bindings → raycast → resolve.
 * This exercises the exact code path the viewport uses at runtime.
 */
function pickFromR3FScene(
  renderables: ViewportRenderableRecord[],
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  opts: { acceptsTarget?: ((target: PrimitiveRef) => boolean) | null } = {},
) {
  const documentGroup = buildR3FDocumentScene(renderables)
  const bindings = collectBindings(documentGroup)

  assert(bindings !== null, 'collectBindings must not return null for a non-null group.')

  const raycaster = createRaycaster(origin, direction)
  const hits = raycaster.intersectObjects(bindings.pickables, true)
  const resolved = resolvePickTarget(hits, bindings.pickIdToRenderable, opts.acceptsTarget ?? null)

  return resolved?.target ?? null
}

/**
 * Sketch display picking matches the viewport's actual code path:
 * the viewport does NOT use resolvePickTarget for sketch hits — it uses
 * getBoundTarget directly on the intersection object.
 */
function pickFromR3FSketchScene(
  renderables: SketchSessionDisplayRenderable[],
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
) {
  const sketchGroup = buildR3FSketchScene(renderables)
  const bindings = collectBindings(sketchGroup)

  assert(bindings !== null, 'collectBindings must not return null for a non-null group.')

  const raycaster = createRaycaster(origin, direction)
  const hits = raycaster.intersectObjects(bindings.pickables, true)

  // The viewport resolves sketch display hits via getBoundTarget on the intersection object,
  // not via resolvePickTarget (sketch display renderables have null pickId).
  const hit = hits.find((intersection) => getBoundTarget(intersection.object) !== null)

  return hit ? getBoundTarget(hit.object) ?? null : null
}

// ===========================================================================
// TESTS: collectBindings correctness
// ===========================================================================

// collectBindings discovers mesh inside BVH wrapper group
{
  const documentGroup = buildR3FDocumentScene([asDocument(solidFaceRenderable)])
  const bindings = collectBindings(documentGroup)

  assert(bindings !== null, 'collectBindings must return bindings for a populated group.')
  assert(bindings.pickables.length >= 1, 'Must discover at least one pickable (the mesh inside BVH wrapper).')
  assert(
    bindings.pickIdToRenderable.has('pick_solid_face'),
    'pickIdToRenderable must map the body face pickId.',
  )
  assertEqual(
    bindings.pickIdToRenderable.get('pick_solid_face')?.id,
    'renderable_solid_face',
    'pickIdToRenderable must map to the correct renderable.',
  )
}

// collectBindings discovers fallback polyline (outside BVH wrapper)
{
  const documentGroup = buildR3FDocumentScene([asDocument(durableEdgeRenderable)])
  const bindings = collectBindings(documentGroup)

  assert(bindings !== null)
  assert(bindings.pickables.length >= 1, 'Must discover the polyline as a pickable.')
  assert(
    bindings.pickIdToRenderable.has('pick_edge'),
    'pickIdToRenderable must map the edge pickId.',
  )
}

// collectBindings discovers marker group; pick proxy excluded from targetToObjects
{
  const documentGroup = buildR3FDocumentScene([asDocument(durableMarkerRenderable)])
  const bindings = collectBindings(documentGroup)

  assert(bindings !== null)
  assert(bindings.pickables.length >= 1, 'Must discover the marker group as a pickable.')
  assert(
    bindings.pickIdToRenderable.has('pick_vertex_marker'),
    'pickIdToRenderable must map the vertex marker pickId.',
  )

  // targetToObjects should contain the visible mesh but not the pick proxy
  const vertexTargetKey = 'vertex:body_a:vertex_a'
  const targetObjects = bindings.targetToObjects.get(vertexTargetKey) ?? []
  for (const obj of targetObjects) {
    assert(
      obj.userData.highlightExcluded !== true,
      'highlightExcluded pick proxy must not appear in targetToObjects.',
    )
  }
}

// collectBindings handles mixed accelerated + fallback renderables
{
  const documentGroup = buildR3FDocumentScene([
    asDocument(solidFaceRenderable),
    asDocument(durableEdgeRenderable),
    asDocument(durableMarkerRenderable),
    asDocument(datumPlaneRenderable),
    asDocument(regionRenderable),
  ])
  const bindings = collectBindings(documentGroup)

  assert(bindings !== null)
  assert(
    bindings.pickIdToRenderable.has('pick_solid_face'),
    'Must discover body face (accelerated mesh inside BVH).',
  )
  assert(
    bindings.pickIdToRenderable.has('pick_region'),
    'Must discover region (accelerated mesh inside BVH).',
  )
  assert(
    bindings.pickIdToRenderable.has('pick_edge'),
    'Must discover edge (fallback polyline).',
  )
  assert(
    bindings.pickIdToRenderable.has('pick_vertex_marker'),
    'Must discover vertex marker (fallback marker group).',
  )
  assert(
    bindings.pickIdToRenderable.has('pick_construction_xy_surface'),
    'Must discover datum plane (fallback mesh — seeded construction skips BVH).',
  )
}

// ===========================================================================
// TESTS: Full pipeline per entity type (R3F scene → collectBindings → raycast → resolve)
// ===========================================================================

// bodyFace pick through R3F pipeline
{
  const target = pickFromR3FScene(
    [asDocument(solidFaceRenderable)],
    [0.25, 0.25, 1],
    [0, 0, -1],
  )

  assertDeepEqual(target, solidFaceRenderable.binding.target, 'bodyFace must resolve through R3F pipeline.')
}

// planarFace pick through R3F pipeline
{
  const target = pickFromR3FScene(
    [asDocument(planarFaceRenderable)],
    [0.25, 0.25, 1],
    [0, 0, -1],
  )

  assertDeepEqual(target, planarFaceRenderable.binding.target, 'planarFace must resolve through R3F pipeline.')
}

// featureEdge pick through R3F pipeline
{
  const target = pickFromR3FScene(
    [asDocument(durableEdgeRenderable)],
    [1, 0.05, 1],
    [0, 0, -1],
  )

  assertDeepEqual(target, durableEdgeRenderable.binding.target, 'featureEdge must resolve through R3F pipeline.')
}

// featureVertex pick through R3F pipeline
{
  const target = pickFromR3FScene(
    [asDocument(durableMarkerRenderable)],
    [2, 3, 6],
    [0, 0, -1],
  )

  assertDeepEqual(target, durableMarkerRenderable.binding.target, 'featureVertex must resolve through R3F pipeline.')
}

// region pick through R3F pipeline
{
  const target = pickFromR3FScene(
    [asDocument(regionRenderable)],
    [0.2, 0.2, 1],
    [0, 0, -1],
  )

  assertDeepEqual(target, regionRenderable.binding.target, 'region must resolve through R3F pipeline.')
}

// construction/datum plane pick through R3F pipeline
{
  const target = pickFromR3FScene(
    [asDocument(datumPlaneRenderable)],
    [0, 0, 1],
    [0, 0, -1],
  )

  assertDeepEqual(target, datumPlaneRenderable.binding.target, 'construction plane must resolve through R3F pipeline.')
}

// sketchCurve display pick through R3F pipeline
{
  const target = pickFromR3FSketchScene(
    [sketchDisplayLine],
    [2, 0.05, 1],
    [0, 0, -1],
  )

  assertDeepEqual(target, sketchDisplayLine.target, 'sketchCurve must resolve through R3F sketch pipeline.')
}

// sketchPoint display pick through R3F pipeline
{
  const target = pickFromR3FSketchScene(
    [sketchDisplayMarker],
    [5, 6, 9],
    [0, 0, -1],
  )

  assertDeepEqual(target, sketchDisplayMarker.target, 'sketchPoint must resolve through R3F sketch pipeline.')
}

// ===========================================================================
// TESTS: Priority and occlusion through R3F pipeline
// ===========================================================================

// Edge at 0.805, face at 0.8 → edge wins (within 0.01 occlusion tolerance)
{
  const documentGroup = buildR3FDocumentScene([
    asDocument(solidFaceRenderable),
    asDocument(durableEdgeRenderable),
  ])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  // Find the actual mesh and line objects for synthetic intersections
  const meshes: THREE.Mesh[] = []
  const lines: THREE.Line[] = []
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_solid_face') meshes.push(obj)
    if (obj instanceof THREE.Line && obj.userData.pickId === 'pick_edge') lines.push(obj)
  })
  assert(meshes.length === 1, 'Must find exactly one body face mesh.')
  assert(lines.length === 1, 'Must find exactly one edge line.')

  const result = resolvePickTarget(
    [
      createIntersection(lines[0], 0.805),
      createIntersection(meshes[0], 0.8),
    ],
    bindings.pickIdToRenderable,
  )

  assertDeepEqual(
    result?.target,
    durableEdgeRenderable.binding.target,
    'Edge within 0.01 of occluding face must win due to higher semantic rank.',
  )
}

// Edge at 1.0, face at 0.8 → face wins (edge occluded behind face by >0.01)
{
  const documentGroup = buildR3FDocumentScene([
    asDocument(solidFaceRenderable),
    asDocument(durableEdgeRenderable),
  ])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  const meshes: THREE.Mesh[] = []
  const lines: THREE.Line[] = []
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_solid_face') meshes.push(obj)
    if (obj instanceof THREE.Line && obj.userData.pickId === 'pick_edge') lines.push(obj)
  })

  const result = resolvePickTarget(
    [
      createIntersection(lines[0], 1.0),
      createIntersection(meshes[0], 0.8),
    ],
    bindings.pickIdToRenderable,
  )

  assertDeepEqual(
    result?.target,
    solidFaceRenderable.binding.target,
    'Edge >0.01 behind occluding face must be occluded; face wins.',
  )
}

// Edge vs construction → edge wins (rank 1 < rank 4)
{
  const documentGroup = buildR3FDocumentScene([
    asDocument(datumPlaneRenderable),
    asDocument(durableEdgeRenderable),
  ])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  const datumMeshes: THREE.Mesh[] = []
  const edgeLines: THREE.Line[] = []
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_construction_xy_surface') datumMeshes.push(obj)
    if (obj instanceof THREE.Line && obj.userData.pickId === 'pick_edge') edgeLines.push(obj)
  })

  const result = resolvePickTarget(
    [
      createIntersection(datumMeshes[0], 1),
      createIntersection(edgeLines[0], 2),
    ],
    bindings.pickIdToRenderable,
  )

  assertDeepEqual(
    result?.target,
    durableEdgeRenderable.binding.target,
    'Edge (rank 1) must beat construction plane (rank 4).',
  )
}

// Face vs region → face wins (rank 2 < rank 3)
{
  const documentGroup = buildR3FDocumentScene([
    asDocument(regionRenderable),
    asDocument(solidFaceRenderable),
  ])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  const regionMeshes: THREE.Mesh[] = []
  const faceMeshes: THREE.Mesh[] = []
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_region') regionMeshes.push(obj)
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_solid_face') faceMeshes.push(obj)
  })

  const result = resolvePickTarget(
    [
      createIntersection(regionMeshes[0], 1),
      createIntersection(faceMeshes[0], 2),
    ],
    bindings.pickIdToRenderable,
  )

  assertDeepEqual(
    result?.target,
    solidFaceRenderable.binding.target,
    'bodyFace (rank 2) must beat region (rank 3).',
  )
}

// ===========================================================================
// TESTS: Highlight state through R3F pipeline
// ===========================================================================

// Hover bodyFace → material color 0xf7c78c
{
  const documentGroup = buildR3FDocumentScene([asDocument(solidFaceRenderable)])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  updateWorkspaceHighlight(bindings.targetToObjects, [], solidFaceRenderable.binding.target)

  const meshes: THREE.Mesh[] = []
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_solid_face') meshes.push(obj)
  })
  assert(meshes[0].material instanceof THREE.MeshStandardMaterial)
  assertEqual(meshes[0].material.color.getHex(), 0xf7c78c, 'Hovered bodyFace must show hover color.')
}

// Hover featureEdge → material color 0xf0a14a
{
  const documentGroup = buildR3FDocumentScene([asDocument(durableEdgeRenderable)])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  updateWorkspaceHighlight(bindings.targetToObjects, [], durableEdgeRenderable.binding.target)

  const lines: THREE.Line[] = []
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Line && obj.userData.pickId === 'pick_edge') lines.push(obj)
  })
  assert(lines[0].material instanceof THREE.LineBasicMaterial)
  assertEqual(lines[0].material.color.getHex(), 0xf0a14a, 'Hovered featureEdge must show wire hover color.')
}

// Select featureVertex → visible mesh gets selected color, pick proxy unchanged
{
  const documentGroup = buildR3FDocumentScene([asDocument(durableMarkerRenderable)])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  updateWorkspaceHighlight(bindings.targetToObjects, [durableMarkerRenderable.binding.target], null)

  let visibleMesh: THREE.Mesh | null = null
  let pickProxy: THREE.Mesh | null = null
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.highlightExcluded === true) {
      pickProxy = obj
    } else if (obj instanceof THREE.Mesh && obj !== documentGroup) {
      // The visible marker mesh (not the pick proxy, not the group itself)
      if (obj.geometry === MARKER_SPHERE_GEOMETRY && !obj.userData.highlightExcluded) {
        visibleMesh = obj
      }
    }
  })

  assert(visibleMesh !== null, 'Must find visible marker mesh.')
  assert(visibleMesh!.material instanceof THREE.MeshStandardMaterial)
  assertEqual(visibleMesh!.material.color.getHex(), 0xf4fbff, 'Selected vertex visible mesh must show selected wire color.')

  assert(pickProxy !== null, 'Must find pick proxy mesh.')
  assert(pickProxy!.material instanceof THREE.MeshBasicMaterial)
  assertEqual(pickProxy!.material.opacity, 0, 'Pick proxy material must remain invisible.')
}

// Hover region → material color 0xa7e4ef
{
  const documentGroup = buildR3FDocumentScene([asDocument(regionRenderable)])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  updateWorkspaceHighlight(bindings.targetToObjects, [], regionRenderable.binding.target)

  const meshes: THREE.Mesh[] = []
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_region') meshes.push(obj)
  })
  assert(meshes[0].material instanceof THREE.MeshStandardMaterial)
  assertEqual(meshes[0].material.color.getHex(), 0xa7e4ef, 'Hovered region must show region hover color.')
}

// Hover then clear → back to base color
{
  const documentGroup = buildR3FDocumentScene([asDocument(solidFaceRenderable)])
  const bindings = collectBindings(documentGroup)
  assert(bindings !== null)

  // Hover
  updateWorkspaceHighlight(bindings.targetToObjects, [], solidFaceRenderable.binding.target)
  const meshes: THREE.Mesh[] = []
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_solid_face') meshes.push(obj)
  })
  assertEqual(meshes[0].material instanceof THREE.MeshStandardMaterial && meshes[0].material.color.getHex(), 0xf7c78c)

  // Clear hover
  updateWorkspaceHighlight(bindings.targetToObjects, [], null)
  assertEqual(
    meshes[0].material instanceof THREE.MeshStandardMaterial ? meshes[0].material.color.getHex() : 0,
    0xf1eee4,
    'After clearing hover, bodyFace must return to base color.',
  )
}

// Sketch display line hover
{
  const sketchGroup = buildR3FSketchScene([sketchDisplayLine])
  const bindings = collectBindings(sketchGroup)
  assert(bindings !== null)

  updateWorkspaceHighlight(bindings.targetToObjects, [], sketchDisplayLine.target)

  const lines: THREE.Line[] = []
  sketchGroup.traverse((obj) => {
    if (obj instanceof THREE.Line) lines.push(obj)
  })
  assert(lines[0].material instanceof THREE.LineBasicMaterial)
  assertEqual(lines[0].material.color.getHex(), 0xf0a14a, 'Hovered sketch display line must show wire hover color.')
}

// ===========================================================================
// TESTS: acceptsTarget filter through R3F pipeline
// ===========================================================================

// Filter accepts only edges → face rejected, edge returned
{
  const target = pickFromR3FScene(
    [asDocument(solidFaceRenderable), asDocument(durableEdgeRenderable)],
    [1, 0, 1],
    [0, 0, -1],
    {
      acceptsTarget: (candidate) => candidate.kind === 'edge',
    },
  )

  assertDeepEqual(
    target,
    durableEdgeRenderable.binding.target,
    'acceptsTarget filter must reject face and fall through to edge.',
  )
}

// ===========================================================================
// TESTS: Preview rendering through R3F pipeline
// ===========================================================================

{
  const documentGroup = buildR3FDocumentScene([
    asDocument(solidFaceRenderable),
    asPreview({
      ...solidFaceRenderable,
      id: 'renderable_preview_face',
      binding: {
        ...solidFaceRenderable.binding,
        pickId: 'pick_preview_face',
      },
    }),
    asPreview({
      ...durableEdgeRenderable,
      id: 'renderable_preview_edge',
      binding: {
        ...durableEdgeRenderable.binding,
        pickId: 'pick_preview_edge',
      },
    }),
    asPreview({
      ...durableMarkerRenderable,
      id: 'renderable_preview_marker',
      binding: {
        ...durableMarkerRenderable.binding,
        pickId: 'pick_preview_marker',
      },
    }),
  ])

  let committedMesh: THREE.Mesh | null = null
  let previewMesh: THREE.Mesh | null = null
  let previewLine: THREE.Line | null = null
  let previewMarkerMesh: THREE.Mesh | null = null

  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_solid_face') committedMesh = obj
    if (obj instanceof THREE.Mesh && obj.userData.pickId === 'pick_preview_face') previewMesh = obj
    if (obj instanceof THREE.Line && obj.userData.pickId === 'pick_preview_edge') previewLine = obj
    // Preview marker visible mesh is inside a group with pickId 'pick_preview_marker'
  })

  // Find preview marker visible mesh (non-highlightExcluded mesh inside marker group)
  documentGroup.traverse((obj) => {
    if (obj instanceof THREE.Group && obj.userData.pickId === 'pick_preview_marker') {
      obj.children.forEach((child) => {
        if (child instanceof THREE.Mesh && !child.userData.highlightExcluded) {
          previewMarkerMesh = child
        }
      })
    }
  })

  assert(committedMesh !== null, 'Must find committed mesh.')
  assert(previewMesh !== null, 'Must find preview mesh.')
  assert(previewLine !== null, 'Must find preview line.')
  assert(previewMarkerMesh !== null, 'Must find preview marker mesh.')

  assert(committedMesh!.material instanceof THREE.MeshStandardMaterial)
  assert(previewMesh!.material instanceof THREE.MeshStandardMaterial)
  assert(previewLine!.material instanceof THREE.LineBasicMaterial)
  assert(previewMarkerMesh!.material instanceof THREE.MeshStandardMaterial)

  assertEqual(committedMesh!.material.opacity, 1, 'Committed mesh opacity must be 1.')
  assertEqual(committedMesh!.renderOrder, 2, 'Committed mesh render order must be 2.')
  assertEqual(previewMesh!.material.opacity, 0.34, 'Preview mesh opacity must be 0.34.')
  assertEqual(previewMesh!.renderOrder, 5, 'Preview mesh render order must be 5.')
  assertEqual(previewLine!.material.opacity, 0.72, 'Preview line opacity must be 0.72.')
  assertEqual(previewLine!.renderOrder, 6, 'Preview line render order must be 6.')
  assertEqual(previewMarkerMesh!.material.opacity, 0.72, 'Preview marker mesh opacity must be 0.72.')
}

// ===========================================================================
// TESTS: BVH partitioning
// ===========================================================================

{
  const partition = partitionViewportRenderablesForBvh([
    asDocument(datumPlaneRenderable),
    asDocument(solidFaceRenderable),
    asDocument(regionRenderable),
    asDocument(durableEdgeRenderable),
    asDocument(durableMarkerRenderable),
  ])

  assertDeepEqual(
    partition.accelerated.map(({ renderable }) => renderable.id),
    [solidFaceRenderable.id, regionRenderable.id],
    'BVH should accelerate mesh-backed document geometry but skip seeded helper planes.',
  )
  assertDeepEqual(
    partition.fallback.map(({ renderable }) => renderable.id),
    [datumPlaneRenderable.id, durableEdgeRenderable.id, durableMarkerRenderable.id],
    'Fallback picking should retain helper planes, polylines, and marker proxy helpers.',
  )
  assertEqual(isBvhAcceleratedDocumentRenderable(asDocument(solidFaceRenderable)), true)
  assertEqual(isBvhAcceleratedDocumentRenderable(asDocument(datumPlaneRenderable)), false)
}

console.log('All render-picking tests passed.')

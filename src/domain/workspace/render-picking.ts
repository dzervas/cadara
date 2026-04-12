import * as THREE from 'three'

import {
  getPrimitiveRefKey,
  primitiveRefEquals,
  type PrimitiveRef,
} from '@/domain/editor/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import type {
  ViewportRenderableOrigin,
  ViewportRenderableRecord,
} from '@/domain/workspace/viewport-renderables'

export interface CollectedBindings {
  pickables: THREE.Object3D[]
  pickIdToRenderable: Map<string, RenderableEntityRecord>
  targetToObjects: Map<string, THREE.Object3D[]>
}

export interface WorkspaceRenderScene {
  group: THREE.Group
  pickables: THREE.Object3D[]
  targetToObjects: Map<string, THREE.Object3D[]>
  pickIdToRenderable: Map<string, RenderableEntityRecord>
}

export interface SketchDisplayScene {
  group: THREE.Group
  pickables: THREE.Object3D[]
  targetToObjects: Map<string, THREE.Object3D[]>
}

/**
 * First-pass BVH acceleration targets mesh-backed document geometry only.
 * Lightweight helper planes, wire renderables, and marker proxy meshes stay on the
 * fallback path until they show a concrete payoff from BVH management.
 */
export const BVH_ACCELERATED_DOCUMENT_GEOMETRY_KINDS = ['mesh'] as const

export const MARKER_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 12, 12)
const PICK_PROXY_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 16, 16)
const SEEDED_DATUM_CONSTRUCTION_IDS = new Set([
  'construction_plane-xy',
  'construction_plane-yz',
  'construction_plane-xz',
])
const VISIBLE_MARKER_SCALE_FACTOR = 0.44
const MARKER_PICK_SCALE_FACTOR = 1.45

export const SURFACE_COLORS = {
  bodyFace: 0xf1eee4,
  planarFace: 0xf1eee4,
  region: 0x93dff2,
  featureEdge: 0x86b6da,
  featureVertex: 0x86b6da,
  sketchCurve: 0x8db7d6,
  sketchPoint: 0x8db7d6,
  construction: 0xb6d6ff,
} as const

interface RenderObjectBundle {
  root: THREE.Object3D
  highlightObjects: THREE.Object3D[]
}

export function buildWorkspaceRenderScene(renderables: ViewportRenderableRecord[]): WorkspaceRenderScene {
  const group = new THREE.Group()
  const pickables: THREE.Object3D[] = []
  const targetToObjects = new Map<string, THREE.Object3D[]>()
  const pickIdToRenderable = new Map<string, RenderableEntityRecord>()

  for (const entry of renderables) {
    const object = createObjectForRenderable(entry)
    const renderable = entry.renderable
    bindRenderableObject(
      object.root,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      entry.origin,
      renderable,
    )
    group.add(object.root)
    pickables.push(object.root)
    pickIdToRenderable.set(renderable.binding.pickId, renderable)

    const targetKey = getPrimitiveRefKey(renderable.binding.target)
    const targetObjects = targetToObjects.get(targetKey) ?? []
    targetObjects.push(...object.highlightObjects)
    targetToObjects.set(targetKey, targetObjects)
  }

  return {
    group,
    pickables,
    targetToObjects,
    pickIdToRenderable,
  }
}

export function isBvhAcceleratedDocumentRenderable(entry: ViewportRenderableRecord) {
  return entry.renderable.geometry.kind === 'mesh'
    && !isSeededDatumPlaneRenderable(entry.renderable)
}

export function partitionViewportRenderablesForBvh(renderables: ViewportRenderableRecord[]) {
  const accelerated: ViewportRenderableRecord[] = []
  const fallback: ViewportRenderableRecord[] = []

  for (const entry of renderables) {
    if (isBvhAcceleratedDocumentRenderable(entry)) {
      accelerated.push(entry)
      continue
    }

    fallback.push(entry)
  }

  return {
    accelerated,
    fallback,
  }
}

export function getViewportRenderableGeometryToken(entry: ViewportRenderableRecord) {
  const { geometry } = entry.renderable

  switch (geometry.kind) {
    case 'mesh':
      return [
        'mesh',
        geometry.vertexPositions.flat().join(','),
        geometry.triangleIndices.flat().join(','),
        geometry.vertexNormals ? geometry.vertexNormals.flat().join(',') : 'auto-normals',
      ].join(':')
    case 'polyline':
      return [
        'polyline',
        geometry.points.flat().join(','),
        geometry.isClosed ? 'closed' : 'open',
      ].join(':')
    case 'marker':
      return [
        'marker',
        geometry.position.join(','),
        geometry.displayRadius,
      ].join(':')
  }
}

export function buildSketchDisplayGroup(renderables: SketchSessionDisplayRenderable[]): SketchDisplayScene {
  const group = new THREE.Group()
  const pickables: THREE.Object3D[] = []
  const targetToObjects = new Map<string, THREE.Object3D[]>()

  for (const renderable of renderables) {
    const object = createDisplayObject(renderable)
    if (renderable.target) {
      bindRenderableObject(
        object.root,
        null,
        renderable.target,
        renderable.geometry.kind === 'marker' ? 'sketchPoint' : 'sketchCurve',
        'document',
      )
      const targetKey = getPrimitiveRefKey(renderable.target)
      const targetObjects = targetToObjects.get(targetKey) ?? []
      targetObjects.push(...object.highlightObjects)
      targetToObjects.set(targetKey, targetObjects)
      pickables.push(object.root)
    }
    group.add(object.root)
  }

  return {
    group,
    pickables,
    targetToObjects,
  }
}

function createDisplayObject(renderable: SketchSessionDisplayRenderable) {
  switch (renderable.geometry.kind) {
    case 'mesh':
      return createDisplayFaceObject(renderable)
    case 'polyline':
      return createDisplayEdgeObject(renderable)
    case 'marker':
      return createDisplayMarkerObject(renderable)
  }
}

function createObjectForRenderable(renderable: ViewportRenderableRecord) {
  switch (renderable.renderable.geometry.kind) {
    case 'mesh':
      return createMeshObject(renderable)
    case 'polyline':
      return createPolylineObject(renderable)
    case 'marker':
      return createMarkerObject(renderable)
  }
}

function createMeshObject(entry: ViewportRenderableRecord) {
  const renderable = entry.renderable
  const geometryData = renderable.geometry.kind === 'mesh' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Renderable ${renderable.id} is missing mesh geometry.`)
  }

  const geometry = new THREE.BufferGeometry()
  const flattenedPositions = geometryData.vertexPositions.flat()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(flattenedPositions, 3),
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
  return {
    root: mesh,
    highlightObjects: [mesh],
  } satisfies RenderObjectBundle
}

function createPolylineObject(entry: ViewportRenderableRecord) {
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
      })
    : createRenderableLineMaterial(renderable, entry.origin)
  const line = new THREE.Line(geometry, material)
  line.renderOrder = isSeededDatumPlaneRenderable(renderable)
    ? 2
    : getRenderableRenderOrder(renderable, entry.origin)
  line.material.depthTest = true
  line.material.depthWrite = false

  if (isSeededDatumPlaneRenderable(renderable)) {
    return {
      root: line,
      highlightObjects: [line],
    } satisfies RenderObjectBundle
  }

  return {
    root: line,
    highlightObjects: [line],
  } satisfies RenderObjectBundle
}

function createMarkerObject(entry: ViewportRenderableRecord) {
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

  const group = new THREE.Group()
  group.add(mesh)
  group.add(createMarkerPickProxy(geometryData.position, geometryData.displayRadius))

  return {
    root: group,
    highlightObjects: [mesh],
  } satisfies RenderObjectBundle
}

function createDisplayFaceObject(renderable: SketchSessionDisplayRenderable) {
  const geometryData = renderable.geometry.kind === 'mesh' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Display renderable ${renderable.id} is missing mesh geometry.`)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometryData.vertexPositions.flat(), 3))
  geometry.setIndex(geometryData.triangleIndices.flat())
  if (geometryData.vertexNormals) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geometryData.vertexNormals.flat(), 3))
  } else {
    geometry.computeVertexNormals()
  }
  const material = new THREE.MeshStandardMaterial({
    color: SURFACE_COLORS.sketchCurve,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    metalness: 0.08,
    roughness: 0.58,
    emissive: 0x214566,
    emissiveIntensity: 0.18,
  })

  const mesh = new THREE.Mesh(geometry, material)
  return {
    root: mesh,
    highlightObjects: [mesh],
  } satisfies RenderObjectBundle
}

function createDisplayEdgeObject(renderable: SketchSessionDisplayRenderable) {
  const geometryData = renderable.geometry.kind === 'polyline' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Display renderable ${renderable.id} is missing polyline geometry.`)
  }

  const points = geometryData.points.map((point) => new THREE.Vector3(point[0], point[1], point[2]))
  const displayPoints = geometryData.isClosed && points.length > 0 ? [...points, points[0].clone()] : points
  const geometry = new THREE.BufferGeometry().setFromPoints(displayPoints)
  const material = new THREE.LineBasicMaterial({
    color: SURFACE_COLORS.sketchCurve,
    transparent: true,
    opacity: 0.95,
  })

  const line = new THREE.Line(geometry, material)
  line.renderOrder = 3
  line.material.depthTest = true
  line.material.depthWrite = false

  return {
    root: line,
    highlightObjects: [line],
  } satisfies RenderObjectBundle
}

function createDisplayMarkerObject(renderable: SketchSessionDisplayRenderable) {
  const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null

  if (!geometryData) {
    throw new Error(`Display renderable ${renderable.id} is missing marker geometry.`)
  }

  const material = new THREE.MeshStandardMaterial({
    color: SURFACE_COLORS.sketchPoint,
    metalness: 0.08,
    roughness: 0.34,
    emissive: 0x1c3245,
    emissiveIntensity: 0.16,
  })
  const mesh = new THREE.Mesh(MARKER_SPHERE_GEOMETRY, material)
  mesh.position.set(geometryData.position[0], geometryData.position[1], geometryData.position[2])
  mesh.scale.setScalar(getVisibleMarkerRadius(geometryData.displayRadius))
  mesh.renderOrder = 4
  mesh.material.depthTest = true
  mesh.material.depthWrite = false

  const group = new THREE.Group()
  group.add(mesh)
  group.add(createMarkerPickProxy(geometryData.position, geometryData.displayRadius))

  return {
    root: group,
    highlightObjects: [mesh],
  } satisfies RenderObjectBundle
}

export function resolvePickTarget(
  intersections: THREE.Intersection<THREE.Object3D>[],
  pickIdToRenderable: Map<string, RenderableEntityRecord>,
  acceptsTarget: ((target: PrimitiveRef) => boolean) | null = null,
) {
  const resolvedHits = intersections
    .map((intersection) => {
      const pickId = getBoundPickId(intersection.object)

      if (!pickId) {
        return null
      }

      const renderable = pickIdToRenderable.get(pickId)

      if (!renderable) {
        return null
      }

      return {
        intersection,
        pickId,
        target: renderable.binding.target,
        renderable,
      }
    })
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
    .sort((left, right) => {
      const semanticRankDelta = getInteractionSortRank(left.renderable) - getInteractionSortRank(right.renderable)

      if (semanticRankDelta !== 0) {
        return semanticRankDelta
      }

      const priorityDelta = left.renderable.binding.pickPriority - right.renderable.binding.pickPriority

      if (priorityDelta !== 0) {
        return priorityDelta
      }

      return left.intersection.distance - right.intersection.distance
    })

  const nearestOccludingFaceDistance = resolvedHits.reduce<number | null>((nearest, hit) => {
    if (!isOccludingFaceRenderable(hit.renderable)) {
      return nearest
    }

    return nearest === null ? hit.intersection.distance : Math.min(nearest, hit.intersection.distance)
  }, null)

  for (const hit of resolvedHits) {
    if (
      nearestOccludingFaceDistance !== null
      && isWireRenderable(hit.renderable)
      && hit.intersection.distance - nearestOccludingFaceDistance > 0.01
    ) {
      continue
    }

    if (acceptsTarget && !acceptsTarget(hit.target)) {
      continue
    }

    return {
      pickId: hit.pickId,
      target: hit.target,
      renderable: hit.renderable,
    }
  }

  return null
}

export function updateWorkspaceHighlight(
  targetToObjects: Map<string, THREE.Object3D[]>,
  selection: PrimitiveRef[],
  hoverTarget: PrimitiveRef | null,
) {
  for (const objects of targetToObjects.values()) {
    for (const object of objects) {
      const material = getObjectMaterial(object)
      const semanticClass = getBoundSemanticClass(object)
      const origin = getBoundRenderableOrigin(object)

      if (!material || !semanticClass || !origin) {
        continue
      }

      const target = getBoundTarget(object)

      if (!target) {
        continue
      }

      const isSelected = selection.some((entry) => primitiveRefEquals(entry, target))
      const isHovered = hoverTarget !== null && primitiveRefEquals(hoverTarget, target)
      applyRenderableState(material, semanticClass, origin, isSelected || isHovered, isSelected)
    }
  }
}

function applyRenderableState(
  material: THREE.Material | THREE.Material[] | THREE.LineBasicMaterial,
  semanticClass: RenderableEntityRecord['binding']['semanticClass'],
  origin: ViewportRenderableOrigin,
  isActive: boolean,
  isSelected: boolean,
) {
  const materials = Array.isArray(material) ? material : [material]

  for (const entry of materials) {
    if (
      !(entry instanceof THREE.MeshStandardMaterial)
      && !(entry instanceof THREE.LineBasicMaterial)
    ) {
      continue
    }

    const color = getHighlightColor(semanticClass, isActive, isSelected)

    entry.color.setHex(color)

    if (entry instanceof THREE.MeshStandardMaterial) {
      entry.emissive.setHex(
        isSelected
          ? 0x2f6b91
          : isActive
            ? 0xa85a16
            : getRenderableMeshEmissive(semanticClass, origin),
      )
      entry.emissiveIntensity = isSelected
        ? 0.32
        : isActive
          ? 0.24
          : getRenderableMeshEmissiveIntensity(semanticClass, origin)
      entry.opacity = getRenderableMeshOpacity(semanticClass, origin, isActive, isSelected)
    } else {
      entry.opacity = getRenderableLineOpacity(semanticClass, origin, isActive, isSelected)
    }
  }
}

function getRenderableBaseColor(semanticClass: RenderableEntityRecord['binding']['semanticClass']) {
  switch (semanticClass) {
    case 'bodyFace':
      return SURFACE_COLORS.bodyFace
    case 'planarFace':
      return SURFACE_COLORS.planarFace
    case 'region':
      return SURFACE_COLORS.region
    case 'featureEdge':
      return SURFACE_COLORS.featureEdge
    case 'featureVertex':
      return SURFACE_COLORS.featureVertex
    case 'sketchCurve':
      return SURFACE_COLORS.sketchCurve
    case 'sketchPoint':
      return SURFACE_COLORS.sketchPoint
    case 'construction':
      return SURFACE_COLORS.construction
  }
}

function getHighlightColor(
  semanticClass: RenderableEntityRecord['binding']['semanticClass'],
  isActive: boolean,
  isSelected: boolean,
) {
  if (isSelected) {
    return isWireSemanticClass(semanticClass) ? 0xf4fbff : 0xf7f4ec
  }

  if (isActive) {
    if (semanticClass === 'construction') {
      return 0xe7f2ff
    }

    if (semanticClass === 'region') {
      return 0xa7e4ef
    }

    if (isWireSemanticClass(semanticClass)) {
      return 0xf0a14a
    }

    return 0xf7c78c
  }

  return getRenderableBaseColor(semanticClass)
}

export function isSeededDatumPlaneRenderable(renderable: RenderableEntityRecord) {
  return renderable.binding.target.kind === 'construction'
    && SEEDED_DATUM_CONSTRUCTION_IDS.has(renderable.binding.target.constructionId)
}

function isWireRenderable(renderable: RenderableEntityRecord) {
  return renderable.binding.semanticClass === 'featureEdge'
    || renderable.binding.semanticClass === 'featureVertex'
    || renderable.binding.semanticClass === 'sketchCurve'
    || renderable.binding.semanticClass === 'sketchPoint'
}

function isOccludingFaceRenderable(renderable: RenderableEntityRecord) {
  return renderable.binding.semanticClass === 'bodyFace' || renderable.binding.semanticClass === 'planarFace'
}

function getInteractionSortRank(renderable: RenderableEntityRecord) {
  switch (renderable.binding.semanticClass) {
    case 'featureVertex':
    case 'sketchPoint':
      return 0
    case 'featureEdge':
    case 'sketchCurve':
      return 1
    case 'bodyFace':
    case 'planarFace':
      return 2
    case 'region':
      return 3
    case 'construction':
      return 4
  }
}

function isWireSemanticClass(semanticClass: RenderableEntityRecord['binding']['semanticClass']) {
  return semanticClass === 'featureEdge'
    || semanticClass === 'featureVertex'
    || semanticClass === 'sketchCurve'
    || semanticClass === 'sketchPoint'
}

function getBaseMeshOpacity(semanticClass: RenderableEntityRecord['binding']['semanticClass']) {
  return semanticClass === 'region' ? 0.22 : 1
}

export function getRenderableRenderOrder(
  renderable: RenderableEntityRecord,
  origin: ViewportRenderableOrigin,
) {
  if (renderable.geometry.kind === 'mesh') {
    return origin === 'preview' ? 5 : 2
  }

  if (renderable.geometry.kind === 'polyline') {
    return origin === 'preview' ? 6 : 3
  }

  return origin === 'preview' ? 7 : 4
}

export function createRenderableMeshMaterial(
  renderable: RenderableEntityRecord,
  origin: ViewportRenderableOrigin,
) {
  const semanticClass = renderable.binding.semanticClass

  return new THREE.MeshStandardMaterial({
    color: getRenderableBaseColor(semanticClass),
    transparent: origin === 'preview' || semanticClass === 'region',
    opacity: getRenderableMeshOpacity(semanticClass, origin, false, false),
    side: THREE.DoubleSide,
    metalness: 0.02,
    roughness: semanticClass === 'region' ? 0.9 : origin === 'preview' ? 0.7 : 0.76,
    emissive: getRenderableMeshEmissive(semanticClass, origin),
    emissiveIntensity: getRenderableMeshEmissiveIntensity(semanticClass, origin),
    depthWrite: origin === 'preview' ? false : true,
    polygonOffset: true,
    polygonOffsetFactor: origin === 'preview' ? -1 : 1,
    polygonOffsetUnits: origin === 'preview' ? -1 : 1,
  })
}

export function createRenderableLineMaterial(
  renderable: RenderableEntityRecord,
  origin: ViewportRenderableOrigin,
) {
  return new THREE.LineBasicMaterial({
    color: getRenderableBaseColor(renderable.binding.semanticClass),
    transparent: true,
    opacity: getRenderableLineOpacity(renderable.binding.semanticClass, origin, false, false),
  })
}

export function createRenderableMarkerMaterial(
  renderable: RenderableEntityRecord,
  origin: ViewportRenderableOrigin,
) {
  return new THREE.MeshStandardMaterial({
    color: getRenderableBaseColor(renderable.binding.semanticClass),
    transparent: origin === 'preview',
    opacity: origin === 'preview' ? 0.72 : 1,
    metalness: 0.08,
    roughness: 0.34,
    emissive: origin === 'preview' ? 0x244a63 : 0x1c3245,
    emissiveIntensity: origin === 'preview' ? 0.16 : 0.12,
    depthWrite: origin === 'preview' ? false : true,
  })
}

function getRenderableMeshEmissive(
  semanticClass: RenderableEntityRecord['binding']['semanticClass'],
  origin: ViewportRenderableOrigin,
) {
  if (semanticClass === 'region') {
    return origin === 'preview' ? 0x173643 : 0x10252d
  }

  return origin === 'preview' ? 0x2f5570 : 0x343028
}

function getRenderableMeshEmissiveIntensity(
  semanticClass: RenderableEntityRecord['binding']['semanticClass'],
  origin: ViewportRenderableOrigin,
) {
  if (semanticClass === 'region') {
    return origin === 'preview' ? 0.12 : 0.08
  }

  return origin === 'preview' ? 0.12 : 0.08
}

function getRenderableMeshOpacity(
  semanticClass: RenderableEntityRecord['binding']['semanticClass'],
  origin: ViewportRenderableOrigin,
  isActive: boolean,
  isSelected: boolean,
) {
  if (semanticClass === 'construction') {
    if (origin === 'preview') {
      return isSelected ? 0.34 : isActive ? 0.26 : 0.18
    }

    return isSelected ? 0.28 : isActive ? 0.2 : 0.12
  }

  if (semanticClass === 'region') {
    if (origin === 'preview') {
      return isSelected ? 0.52 : isActive ? 0.42 : 0.32
    }

    return isSelected ? 0.44 : isActive ? 0.34 : 0.22
  }

  if (origin === 'preview') {
    return isSelected ? 0.58 : isActive ? 0.48 : 0.34
  }

  return getBaseMeshOpacity(semanticClass)
}

function getRenderableLineOpacity(
  semanticClass: RenderableEntityRecord['binding']['semanticClass'],
  origin: ViewportRenderableOrigin,
  isActive: boolean,
  isSelected: boolean,
) {
  if (semanticClass === 'construction') {
    if (origin === 'preview') {
      return isSelected ? 0.92 : isActive ? 0.74 : 0.56
    }

    return isSelected ? 0.85 : isActive ? 0.62 : 0.4
  }

  if (origin === 'preview') {
    return isSelected ? 0.96 : isActive ? 0.86 : 0.72
  }

  return isSelected ? 1 : isActive ? 0.98 : 0.94
}

function getObjectMaterial(object: THREE.Object3D) {
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    return object.material
  }

  return null
}

export function bindRenderableObject(
  object: THREE.Object3D,
  pickId: string | null,
  target: PrimitiveRef,
  semanticClass: RenderableEntityRecord['binding']['semanticClass'],
  origin: ViewportRenderableOrigin,
  renderable?: RenderableEntityRecord,
) {
  object.userData.target = target
  object.userData.semanticClass = semanticClass
  object.userData.renderableOrigin = origin
  if (renderable) {
    object.userData.renderableRecord = renderable
  }

  if (pickId !== null) {
    object.userData.pickId = pickId
  }
}

function getBoundPickId(object: THREE.Object3D) {
  return findBoundValue<string>(object, 'pickId')
}

export function getBoundTarget(object: THREE.Object3D) {
  return findBoundValue<PrimitiveRef>(object, 'target')
}

export function getBoundRenderableRecord(object: THREE.Object3D) {
  return findBoundValue<RenderableEntityRecord>(object, 'renderableRecord')
}

function getBoundSemanticClass(object: THREE.Object3D) {
  return findBoundValue<RenderableEntityRecord['binding']['semanticClass']>(object, 'semanticClass')
}

function getBoundRenderableOrigin(object: THREE.Object3D) {
  return findBoundValue<ViewportRenderableOrigin>(object, 'renderableOrigin')
}

function findBoundValue<T>(object: THREE.Object3D, key: string) {
  let current: THREE.Object3D | null = object

  while (current) {
    const value = current.userData[key] as T | undefined

    if (value !== undefined) {
      return value
    }

    current = current.parent
  }

  return undefined
}

export function createMarkerPickProxy(position: readonly [number, number, number], displayRadius: number) {
  const material = createInvisiblePickMaterial()
  const mesh = new THREE.Mesh(PICK_PROXY_SPHERE_GEOMETRY, material)
  mesh.position.set(position[0], position[1], position[2])
  mesh.scale.setScalar(Math.max(displayRadius * MARKER_PICK_SCALE_FACTOR, displayRadius, Number.EPSILON))
  return mesh
}

export function createInvisiblePickMaterial() {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  })
  material.colorWrite = false
  return material
}

export function getVisibleMarkerRadius(displayRadius: number) {
  return Math.max(displayRadius * VISIBLE_MARKER_SCALE_FACTOR, Number.EPSILON)
}

export function collectBindings(root: THREE.Object3D | null): CollectedBindings | null {
  if (!root) {
    return null
  }

  const pickables: THREE.Object3D[] = []
  const pickIdToRenderable = new Map<string, RenderableEntityRecord>()
  const targetToObjects = new Map<string, THREE.Object3D[]>()

  root.traverse((object) => {
    if (object.userData.pickId !== undefined || object.userData.target !== undefined) {
      pickables.push(object)
    }

    const pickId = object.userData.pickId as string | undefined
    const renderableRecord = getBoundRenderableRecord(object)

    if (pickId && renderableRecord) {
      pickIdToRenderable.set(pickId, renderableRecord)
    }

    if (object.userData.highlightExcluded === true) {
      return
    }

    const target = getBoundTarget(object)

    if (!target || !(object instanceof THREE.Mesh || object instanceof THREE.Line)) {
      return
    }

    const key = getPrimitiveRefKey(target)
    const entries = targetToObjects.get(key) ?? []
    entries.push(object)
    targetToObjects.set(key, entries)
  })

  return {
    pickables,
    pickIdToRenderable,
    targetToObjects,
  }
}

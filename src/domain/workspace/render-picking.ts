import * as THREE from 'three'

import {
  getPrimitiveRefKey,
  primitiveRefEquals,
  type PrimitiveRef,
} from '@/domain/editor/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type {
  ViewportRenderableOrigin,
} from '@/domain/workspace/viewport-renderables'

export interface CollectedBindings {
  pickables: THREE.Object3D[]
  targetToObjects: Map<string, THREE.Object3D[]>
}

interface PickResolutionOptions {
  wireOcclusionTolerance?: number
  sameLayerTolerance?: number
}

export const MARKER_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 12, 12)
const PICK_PROXY_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 16, 16)
const SEEDED_DATUM_CONSTRUCTION_IDS = new Set([
  'construction_plane-xy',
  'construction_plane-yz',
  'construction_plane-xz',
])
const VISIBLE_MARKER_SCALE_FACTOR = 0.44
const MARKER_PICK_SCALE_FACTOR = 1.45
export const DEFAULT_LINE_PICK_THRESHOLD = 0.75
const DEFAULT_WIRE_OCCLUSION_TOLERANCE = 0.01
const DEFAULT_SAME_LAYER_TOLERANCE = 0.004

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

export function resolvePickTarget(
  intersections: THREE.Intersection<THREE.Object3D>[],
  acceptsTarget: ((target: PrimitiveRef) => boolean) | null = null,
  options: PickResolutionOptions = {},
) {
  const wireOcclusionTolerance = options.wireOcclusionTolerance ?? DEFAULT_WIRE_OCCLUSION_TOLERANCE
  const sameLayerTolerance = options.sameLayerTolerance ?? DEFAULT_SAME_LAYER_TOLERANCE
  const resolvedHits = intersections
    .map((intersection) => {
      const target = getBoundTarget(intersection.object)
      const semanticClass = getBoundSemanticClass(intersection.object)
      const origin = getBoundRenderableOrigin(intersection.object)

      if (!target || !semanticClass || !origin) {
        return null
      }

      return {
        intersection,
        pickId: getBoundPickId(intersection.object) ?? null,
        target,
        priority: getBoundPickPriority(intersection.object) ?? Number.POSITIVE_INFINITY,
        semanticClass,
        renderable: getBoundRenderableRecord(intersection.object) ?? null,
      }
    })
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
    .filter(createUniqueHitFilter())
    .sort((left, right) => {
      const distanceDelta = left.intersection.distance - right.intersection.distance

      if (Math.abs(distanceDelta) > sameLayerTolerance) {
        return distanceDelta
      }

      const rankDelta = getInteractionSortRank(left.semanticClass) - getInteractionSortRank(right.semanticClass)

      if (rankDelta !== 0) {
        return rankDelta
      }

      const priorityDelta = left.priority - right.priority

      if (priorityDelta !== 0) {
        return priorityDelta
      }

      return getHitStableKey(left).localeCompare(getHitStableKey(right))
    })

  const nearestOccludingFaceDistance = resolvedHits.reduce<number | null>((nearest, hit) => {
    if (!isOccludingFaceSemanticClass(hit.semanticClass)) {
      return nearest
    }

    return nearest === null
      ? hit.intersection.distance
      : Math.min(nearest, hit.intersection.distance)
  }, null)

  for (const hit of resolvedHits) {
    if (
      nearestOccludingFaceDistance !== null
      && isWireSemanticClass(hit.semanticClass)
      && hit.intersection.distance - nearestOccludingFaceDistance > wireOcclusionTolerance
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

function isWireSemanticClass(semanticClass: RenderableEntityRecord['binding']['semanticClass']) {
  return semanticClass === 'featureEdge'
    || semanticClass === 'featureVertex'
    || semanticClass === 'sketchCurve'
    || semanticClass === 'sketchPoint'
}

function isOccludingFaceSemanticClass(semanticClass: RenderableEntityRecord['binding']['semanticClass']) {
  return semanticClass === 'bodyFace' || semanticClass === 'planarFace'
}

function getInteractionSortRank(semanticClass: RenderableEntityRecord['binding']['semanticClass']) {
  switch (semanticClass) {
    case 'featureVertex':
    case 'sketchPoint':
      return 0
    case 'featureEdge':
    case 'sketchCurve':
      return 1
    case 'region':
      return 2
    case 'bodyFace':
    case 'planarFace':
      return 3
    case 'construction':
      return 4
  }
}

function createUniqueHitFilter() {
  const seen = new Set<string>()

  return (hit: {
    pickId: string | null
    target: PrimitiveRef
    semanticClass: RenderableEntityRecord['binding']['semanticClass']
    renderable: RenderableEntityRecord | null
  }) => {
    const key = hit.pickId
      ?? hit.renderable?.id
      ?? `${hit.semanticClass}:${getPrimitiveRefKey(hit.target)}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  }
}

function getHitStableKey(hit: {
  pickId: string | null
  target: PrimitiveRef
  semanticClass: RenderableEntityRecord['binding']['semanticClass']
  renderable: RenderableEntityRecord | null
}) {
  return [
    hit.pickId ?? '',
    hit.renderable?.id ?? '',
    hit.semanticClass,
    getPrimitiveRefKey(hit.target),
  ].join(':')
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
  object.userData.pickPriority = renderable?.binding.pickPriority
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

function getBoundPickPriority(object: THREE.Object3D) {
  return findBoundValue<number>(object, 'pickPriority')
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
  mesh.scale.setScalar(getBaseMarkerPickRadius(displayRadius))
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
  const targetToObjects = new Map<string, THREE.Object3D[]>()

  root.traverse((object) => {
    if (object.userData.pickId !== undefined || object.userData.target !== undefined) {
      pickables.push(object)
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
    targetToObjects,
  }
}

function getBaseMarkerPickRadius(displayRadius: number) {
  return Math.max(displayRadius * MARKER_PICK_SCALE_FACTOR, displayRadius, Number.EPSILON)
}

import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { PrimitiveRef } from '@/core/editor/schema'
import { getPrimitiveRefKey } from '@/core/editor/schema'

type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export type SectionViewSeedTarget = Extract<PrimitiveRef, { kind: 'construction' | 'face' | 'region' }>
export type SectionViewRetainedSide = 'positive' | 'negative'

export interface SectionViewSession {
  seed: SectionViewSeedTarget
  plane: SketchPlaneDefinition
  offset: number
  retainedSide: SectionViewRetainedSide
}

const FACE_PLANE_TOLERANCE = 1e-9

export function createSectionViewSession(input: {
  snapshot: DocumentSnapshot | null
  seed: SectionViewSeedTarget
  cameraPosition: Vec3
}): SectionViewSession | null {
  const plane = resolveSectionViewPlane(input.snapshot, input.seed)

  if (!plane) {
    return null
  }

  return {
    seed: input.seed,
    plane,
    offset: 0,
    retainedSide: getRetainedSideAwayFromCamera(plane.frame, input.cameraPosition),
  }
}

export function resolveSectionViewPlane(
  snapshot: DocumentSnapshot | null,
  seed: SectionViewSeedTarget,
): SketchPlaneDefinition | null {
  switch (seed.kind) {
    case 'construction': {
      const construction = snapshot?.document.constructions.find(
        (entry) => entry.constructionId === seed.constructionId,
      )

      return construction?.plane ?? null
    }
    case 'face':
      return snapshot ? createFaceBackedPlane(snapshot, seed) : null
    case 'region': {
      const sketch = snapshot?.document.sketches.find((entry) => entry.sketchId === seed.sketchId)
      return sketch
        ? {
            support: sketch.plane.support,
            frame: sketch.plane.frame,
            key: sketch.plane.key ?? sketch.planeKey ?? null,
          }
        : null
    }
  }
}

export function getRetainedSideAwayFromCamera(
  frame: SketchPlaneDefinition['frame'],
  cameraPosition: Vec3,
): SectionViewRetainedSide {
  const signedDistance = dot(subtract(cameraPosition, frame.origin), frame.normal)
  return signedDistance >= 0 ? 'negative' : 'positive'
}

export function getSectionPlaneOrigin(section: Pick<SectionViewSession, 'plane' | 'offset'>): Vec3 {
  return add(section.plane.frame.origin, scale(section.plane.frame.normal, section.offset))
}

export function flipSectionViewRetainedSide(
  retainedSide: SectionViewRetainedSide,
): SectionViewRetainedSide {
  return retainedSide === 'positive' ? 'negative' : 'positive'
}

export function getSectionPlaneSignedDistance(
  section: Pick<SectionViewSession, 'plane' | 'offset'>,
  point: Vec3,
) {
  return dot(subtract(point, getSectionPlaneOrigin(section)), section.plane.frame.normal)
}

export function keepSectionPoint(
  section: Pick<SectionViewSession, 'plane' | 'offset' | 'retainedSide'>,
  point: Vec3,
) {
  const signedDistance = getSectionPlaneSignedDistance(section, point)
  return section.retainedSide === 'positive'
    ? signedDistance >= -FACE_PLANE_TOLERANCE
    : signedDistance <= FACE_PLANE_TOLERANCE
}

export function projectPointToSectionPlane(
  frame: SketchPlaneDefinition['frame'],
  point: Vec3,
): Vec2 {
  const delta = subtract(point, frame.origin)
  return [dot(delta, frame.xAxis), dot(delta, frame.yAxis)]
}

export function mapSectionPlanePointToWorld(
  frame: SketchPlaneDefinition['frame'],
  point: Vec2,
  offset = 0,
): Vec3 {
  return add(
    add(
      add(frame.origin, scale(frame.xAxis, point[0])),
      scale(frame.yAxis, point[1]),
    ),
    scale(frame.normal, offset),
  )
}

function createFaceBackedPlane(
  snapshot: DocumentSnapshot,
  target: Extract<PrimitiveRef, { kind: 'face' }>,
): SketchPlaneDefinition | null {
  const targetKey = getPrimitiveRefKey(target)
  const entity = snapshot.presentation.entities.find((entry) => getPrimitiveRefKey(entry.target) === targetKey)

  if (!entity?.selectionSemantics.includes('planarFace')) {
    return null
  }

  const renderable = snapshot.document.render.records.find((record) =>
    record.binding.target.kind === 'face'
    && record.binding.target.bodyId === target.bodyId
    && record.binding.target.faceId === target.faceId
    && record.binding.semanticClass === 'planarFace'
    && record.geometry.kind === 'mesh',
  )

  if (!renderable || renderable.geometry.kind !== 'mesh') {
    return null
  }

  const frame = createPlaneFrameFromMesh(renderable.geometry)

  return frame
    ? {
        support: target,
        frame,
        key: null,
      }
    : null
}

function createPlaneFrameFromMesh(
  geometry: Extract<DocumentSnapshot['document']['render']['records'][number]['geometry'], { kind: 'mesh' }>,
): SketchPlaneDefinition['frame'] | null {
  for (const triangle of geometry.triangleIndices) {
    const p0 = geometry.vertexPositions[triangle[0]]
    const p1 = geometry.vertexPositions[triangle[1]]
    const p2 = geometry.vertexPositions[triangle[2]]

    if (!p0 || !p1 || !p2) {
      continue
    }

    const normal = normalize(
      geometry.vertexNormals?.[triangle[0]]
      ?? cross(subtract(p1, p0), subtract(p2, p0)),
    )

    if (!normal) {
      continue
    }

    const xAxis = projectAxis(subtract(p1, p0), normal) ?? projectAxis(subtract(p2, p0), normal)

    if (!xAxis) {
      continue
    }

    const yAxis = normalize(cross(normal, xAxis))

    if (!yAxis) {
      continue
    }

    return {
      origin: p0,
      xAxis,
      yAxis,
      normal,
      linearUnit: 'documentLength',
      handedness: 'rightHanded',
    }
  }

  return null
}

function projectAxis(axis: Vec3, normal: Vec3): Vec3 | null {
  return normalize(subtract(axis, scale(normal, dot(axis, normal))))
}

export function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

export function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

export function scale(vector: Vec3, scalar: number): Vec3 {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar]
}

export function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

export function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

export function magnitude(vector: Vec3) {
  return Math.hypot(vector[0], vector[1], vector[2])
}

export function normalize(vector: Vec3): Vec3 | null {
  const length = magnitude(vector)

  if (length <= FACE_PLANE_TOLERANCE) {
    return null
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

import type { PrimitiveRef, RevisionId } from '@/core/editor/schema'
import {
  createNewSketchSession,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  getSketchSessionDisplayRenderables,
  type SketchSessionDisplayRenderable,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type {
  ModelingCommitSketchResult,
  ModelingService,
} from '@/domain/modeling/modeling-service'
import type { AppResult } from '@/contracts/errors'
import { getPrimitiveRefKey } from '@/core/editor/schema'
import type { ViewportRenderableRecord } from '@/core/workspace/viewport-renderables'

type Vec3 = readonly [number, number, number]

const FACE_PLANE_TOLERANCE = 1e-9

export function openSketchSessionFromSelection(
  selection: PrimitiveRef[],
  snapshot: WorkspaceSnapshot | null,
): SketchSessionState | null {
  const primary = selection[0]

  if (!primary) {
    return null
  }

  if (primary.kind === 'sketch' && snapshot) {
    const sketch = snapshot.document.sketches.find((entry) => entry.sketchId === primary.sketchId)
    return sketch ? createSketchSessionFromSnapshot(sketch) : null
  }

  if (primary.kind === 'construction') {
    const construction = snapshot?.document.constructions.find(
      (entry) => entry.constructionId === primary.constructionId,
    )

    if (construction) {
      return createNewSketchSession(construction.plane)
    }

    return createNewSketchSessionFromSupport(primary)
  }

  if (primary.kind === 'face' && snapshot) {
    const plane = createFaceBackedSketchPlane(snapshot, primary)
    return plane ? createNewSketchSession(plane) : null
  }

  return null
}

export function canStartSketchFromTarget(target: PrimitiveRef, snapshot: WorkspaceSnapshot | null) {
  if (target.kind === 'construction') {
    return true
  }

  if (target.kind === 'face' && snapshot) {
    return createFaceBackedSketchPlane(snapshot, target) !== null
  }

  if (target.kind !== 'sketch' || !snapshot) {
    return false
  }

  return snapshot.document.sketches.some((entry) => entry.sketchId === target.sketchId)
}

function createFaceBackedSketchPlane(
  snapshot: WorkspaceSnapshot,
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

  const frame = createSketchPlaneFrameFromFaceMesh(renderable.geometry)

  if (!frame) {
    return null
  }

  return {
    support: target,
    frame,
    key: null,
  }
}

function createSketchPlaneFrameFromFaceMesh(
  geometry: Extract<RenderableEntityRecord['geometry'], { kind: 'mesh' }>,
): SketchPlaneDefinition['frame'] | null {
  for (const triangle of geometry.triangleIndices) {
    const p0 = geometry.vertexPositions[triangle[0]]
    const p1 = geometry.vertexPositions[triangle[1]]
    const p2 = geometry.vertexPositions[triangle[2]]

    if (!p0 || !p1 || !p2) {
      continue
    }

    const normal = getFaceNormal(geometry, triangle, p0, p1, p2)
    if (!normal) {
      continue
    }

    const xAxis = getProjectedAxis(subtract(p1, p0), normal)
      ?? getProjectedAxis(subtract(p2, p0), normal)

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

function getFaceNormal(
  geometry: Extract<RenderableEntityRecord['geometry'], { kind: 'mesh' }>,
  triangle: readonly [number, number, number],
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
) {
  const vertexNormal = geometry.vertexNormals?.[triangle[0]]
  const normalizedVertexNormal = vertexNormal ? normalize(vertexNormal) : null

  if (normalizedVertexNormal) {
    return normalizedVertexNormal
  }

  return normalize(cross(subtract(p1, p0), subtract(p2, p0)))
}

function getProjectedAxis(axis: Vec3, normal: Vec3) {
  return normalize(subtract(axis, scale(normal, dot(axis, normal))))
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar]
}

function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function normalize(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2])

  if (length <= FACE_PLANE_TOLERANCE) {
    return null
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

export async function commitActiveSketchSession(input: {
  modelingService: ModelingService
  session: SketchSessionState
  baseRevisionId: RevisionId
}): Promise<AppResult<ModelingCommitSketchResult> | null> {
  if (!input.session.commitRequest) {
    return null
  }

  const result = await input.modelingService.commitSketch({
    baseRevisionId: input.baseRevisionId,
    ...input.session.commitRequest,
    solverCorrelation: null,
  })

  return result
}

export function mergeSketchRenderables<T extends RenderableEntityRecord | ViewportRenderableRecord>(
  documentRenderables: T[],
  session: SketchSessionState | null,
) {
  if (!session) {
    return {
      documentRenderables,
      sketchDisplayRenderables: [],
    }
  }

  const activeSketchId = session.sketchId
  const visibleDocumentRenderables = activeSketchId
    ? documentRenderables.filter((entry) => !isActiveSketchRenderable(entry, activeSketchId))
    : documentRenderables

  return {
    documentRenderables: visibleDocumentRenderables,
    sketchDisplayRenderables: getSketchSessionDisplayRenderables(session),
  }
}

export type MergedSketchRenderables = {
  documentRenderables: Array<RenderableEntityRecord | ViewportRenderableRecord>
  sketchDisplayRenderables: SketchSessionDisplayRenderable[]
}

function isActiveSketchRenderable(
  entry: RenderableEntityRecord | ViewportRenderableRecord,
  sketchId: NonNullable<SketchSessionState['sketchId']>,
) {
  const renderable = 'renderable' in entry ? entry.renderable : entry
  const target = renderable.binding.target

  return (target.kind === 'region' && target.sketchId === sketchId)
    || (target.kind === 'sketchEntity' && target.sketchId === sketchId)
    || (target.kind === 'sketchPoint' && target.sketchId === sketchId)
}

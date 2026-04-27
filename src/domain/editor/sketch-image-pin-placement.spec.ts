import { test } from 'bun:test'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import {
  createSketchSessionFromSnapshot,
  getSketchSessionDisplayRenderables,
  startSketchDraw,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

test('src/domain/editor/sketch-image-pin-placement.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function makePoint(pointId: string, label: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label,
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: pointId as `sketch_point_${string}` } as const,
      position: [x, y] as const,
      isConstruction: true,
    }
  }

  function createDefinition(): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_tl', 'sketch_point_tr', 'sketch_point_br', 'sketch_point_bl'],
      points: [
        makePoint('sketch_point_tl', 'TL', 0, 1),
        makePoint('sketch_point_tr', 'TR', 1, 1),
        makePoint('sketch_point_br', 'BR', 1, 0),
        makePoint('sketch_point_bl', 'BL', 0, 0),
      ],
      entityIds: ['sketch_entity_image'],
      entities: [{
        kind: 'imageReference',
        entityId: 'sketch_entity_image',
        label: 'Image',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_image' },
        isConstruction: true,
        cornerPointIds: ['sketch_point_tl', 'sketch_point_tr', 'sketch_point_br', 'sketch_point_bl'],
        embeddedBinaryId: 'asset_image_reference',
        pixelWidth: 100,
        pixelHeight: 100,
      }],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
      derivedRelationships: [],
      authoringOperations: [],
    }
  }

  function createImportedImageDefinition(): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_tl', 'sketch_point_tr', 'sketch_point_br', 'sketch_point_bl'],
      points: [
        makePoint('sketch_point_tl', 'TL', -100, 50),
        makePoint('sketch_point_tr', 'TR', 100, 50),
        makePoint('sketch_point_br', 'BR', 100, -50),
        makePoint('sketch_point_bl', 'BL', -100, -50),
      ],
      entityIds: ['sketch_entity_image'],
      entities: [{
        kind: 'imageReference',
        entityId: 'sketch_entity_image',
        label: 'Image',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_image' },
        isConstruction: true,
        cornerPointIds: ['sketch_point_tl', 'sketch_point_tr', 'sketch_point_br', 'sketch_point_bl'],
        embeddedBinaryId: 'asset_image_reference',
        pixelWidth: 400,
        pixelHeight: 200,
      }],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
      derivedRelationships: [],
      authoringOperations: [],
    }
  }

  function createSession(definition: SketchDefinition = createDefinition()) {
    const plane = createStandardPlaneDefinition('xy')
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })

    return createSketchSessionFromSnapshot({
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_primary',
      ownerBodyId: null,
      sketchId: 'sketch_primary',
      label: 'Sketch',
      plane,
      planeTarget: plane.support,
      planeKey: 'xy',
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_0001',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_primary',
        ownerBodyId: null,
        sketchId: 'sketch_primary',
        label: 'Sketch',
        planeSupport: plane.support,
        definition,
        solvedSnapshot: solved.solvedSnapshot,
        regions: [],
      },
    } satisfies SketchSnapshotRecord)
  }

  const baseSession = { ...createSession(), activeTool: 'anchorPoint' as const }
  const pinnedSession = startSketchDraw(baseSession, [0.5, 0.5])
  assert(pinnedSession.definition.points.length === 5, 'Clicking inside the image should create one pinned sketch point.')
  assert(pinnedSession.definition.constraints.length === 1, 'Clicking inside the image should create one point-on-image constraint.')
  const imageConstraint = pinnedSession.definition.constraints[0]
  assert(imageConstraint?.kind === 'pointOnImage', 'The authored constraint should be point-on-image.')
  assert(Math.abs(imageConstraint.u - 0.5) < 1e-6 && Math.abs(imageConstraint.v - 0.5) < 1e-6, 'Center click should store normalized UV coordinates at the image center.')
  const pinnedPoint = pinnedSession.definition.points.find((point) => point.pointId === imageConstraint.pointId)
  assert(pinnedPoint?.isConstruction === true, 'Image pin points should be authored as construction geometry.')
  assert(pinnedSession.commitRequest?.definition.constraints[0]?.kind === 'pointOnImage', 'Image pin authoring should flow into the sketch commit payload.')

  const marker = getSketchSessionDisplayRenderables(pinnedSession).find((entry) =>
    entry.target?.kind === 'sketchPoint' && entry.target.pointId === imageConstraint.pointId,
  )
  assert(marker?.geometry.kind === 'marker', 'Pinned points should render as point markers.')
  assert(marker.geometry.displayRadius === 0.2, 'Pinned image markers should render with the distinct pinned-point radius.')
  assert(marker.paintStyle?.color === 0xf6c356, 'Pinned image markers should render with the pinned-point fill color.')

  const outsideSession = startSketchDraw(baseSession, [1.5, 0.5])
  assert(outsideSession.definition.points.length === baseSession.definition.points.length, 'Clicks outside the image should not author a pin point.')

  const importedSession = { ...createSession(createImportedImageDefinition()), activeTool: 'anchorPoint' as const }
  const importedCornerMarker = getSketchSessionDisplayRenderables(importedSession).find((entry) =>
    entry.target?.kind === 'sketchPoint' && entry.target.pointId === 'sketch_point_tl',
  )
  assert(importedCornerMarker?.geometry.kind === 'marker', 'Imported image corners should render as point markers.')
  assert(importedCornerMarker.geometry.displayRadius > 2, 'Imported image corners should scale their marker radius to remain visible at default image extents.')

  const importedPinnedSession = startSketchDraw(importedSession, [0, 0])
  const importedPinConstraint = importedPinnedSession.definition.constraints.find((constraint) => constraint.kind === 'pointOnImage')
  assert(importedPinConstraint?.kind === 'pointOnImage', 'Clicks inside an imported image should create a point-on-image constraint.')
  const importedPinMarker = getSketchSessionDisplayRenderables(importedPinnedSession).find((entry) =>
    entry.target?.kind === 'sketchPoint' && entry.target.pointId === importedPinConstraint.pointId,
  )
  assert(importedPinMarker?.geometry.kind === 'marker', 'Imported image pins should render as point markers.')
  assert(importedPinMarker.geometry.displayRadius > 2, 'Imported image pins should scale their marker radius to remain visible at default image extents.')
})

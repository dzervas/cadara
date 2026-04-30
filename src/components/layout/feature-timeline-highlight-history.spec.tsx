import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeatureTimelineBar } from '@/components/layout/feature-timeline-bar'
import {
  getEditorViewState,
  initialEditorState,
} from '@/domain/editor/state-machine'
import type {
  FeatureDefinition,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type {
  FeatureId,
  RegionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from '@/contracts/sketch/schema'
import {
  createOccAuthoringState,
  rebuildOccAuthoringState,
} from '@/domain/modeling/occ/authoring-state'
import { extractPlanarFaceData } from '@/domain/modeling/occ/planes'
import { getDefaultOpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import { buildOccWorkspaceSnapshot } from '@/domain/modeling/occ/snapshot'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { getTargetContributingFeatureIds } from '@/domain/modeling/document-snapshot-view'
import { getPrimitiveRefKey, type PrimitiveRef } from '@/core/editor/schema'
import { EditorContext } from '@/hooks/editor-context'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/feature-timeline-highlight-history.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function pointId(name: string) {
    return `sketch_point_${name}` as SketchPointId
  }

  function entityId(name: string) {
    return `sketch_entity_${name}` as SketchEntityId
  }

  function createSketchDefinition(
    sketchId: SketchId,
    points: Array<{ id: SketchPointId; position: readonly [number, number] }>,
    entities: SketchDefinition['entities'],
  ): SketchDefinition {
    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.id),
      points: points.map((point) => ({
        pointId: point.id,
        label: point.id,
        target: { kind: 'sketchPoint', sketchId, pointId: point.id },
        position: point.position,
        isConstruction: false,
      })),
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
  }

  function createSketchRecord(
    sketchId: SketchId,
    plane: SketchPlaneDefinition,
    definition: SketchDefinition,
    solvedEntities: SketchRecord['solvedSnapshot']['solvedEntities'],
    regions: RegionRecord[],
  ): SketchSnapshotRecord {
    const sketch: SketchRecord = {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      sketchId,
      label: sketchId,
      planeSupport: plane.support,
      definition,
      solvedSnapshot: {
        schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
        status: {
          solveState: 'solved',
          constraintState: 'wellConstrained',
        },
        solvedEntities,
        solvedPoints: [],
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      regions,
    }

    return {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      sketchId,
      label: sketchId,
      plane,
      planeTarget: plane.support,
      planeKey: plane.key,
      sketch,
    }
  }

  function createRectangleSketch(sketchId: SketchId, plane: SketchPlaneDefinition) {
    const points = [
      { id: pointId(`${sketchId}_bottom_left`), position: [0, 0] as const },
      { id: pointId(`${sketchId}_bottom_right`), position: [10, 0] as const },
      { id: pointId(`${sketchId}_top_right`), position: [10, 8] as const },
      { id: pointId(`${sketchId}_top_left`), position: [0, 8] as const },
    ]
    const entities = [
      {
        kind: 'lineSegment' as const,
        entityId: entityId(`${sketchId}_bottom`),
        label: 'bottom',
        target: { kind: 'sketchEntity' as const, sketchId, entityId: entityId(`${sketchId}_bottom`) },
        isConstruction: false,
        startPointId: points[0]!.id,
        endPointId: points[1]!.id,
      },
      {
        kind: 'lineSegment' as const,
        entityId: entityId(`${sketchId}_right`),
        label: 'right',
        target: { kind: 'sketchEntity' as const, sketchId, entityId: entityId(`${sketchId}_right`) },
        isConstruction: false,
        startPointId: points[1]!.id,
        endPointId: points[2]!.id,
      },
      {
        kind: 'lineSegment' as const,
        entityId: entityId(`${sketchId}_top`),
        label: 'top',
        target: { kind: 'sketchEntity' as const, sketchId, entityId: entityId(`${sketchId}_top`) },
        isConstruction: false,
        startPointId: points[2]!.id,
        endPointId: points[3]!.id,
      },
      {
        kind: 'lineSegment' as const,
        entityId: entityId(`${sketchId}_left`),
        label: 'left',
        target: { kind: 'sketchEntity' as const, sketchId, entityId: entityId(`${sketchId}_left`) },
        isConstruction: false,
        startPointId: points[3]!.id,
        endPointId: points[0]!.id,
      },
    ]
    const definition = createSketchDefinition(sketchId, points, entities)
    const regionId = `region_${sketchId}_outer` as RegionId

    return {
      sketch: createSketchRecord(
        sketchId,
        plane,
        definition,
        entities.map((entity, index) => ({
          kind: 'lineSegment' as const,
          entityId: entity.entityId,
          startPosition: points[index]!.position,
          endPosition: points[(index + 1) % points.length]!.position,
        })),
        [{
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_0001',
          ownerFeatureId: null,
          ownerSketchId: sketchId,
          ownerBodyId: null,
          regionId,
          label: regionId,
          target: { kind: 'region', sketchId, regionId },
          sourceSketch: { kind: 'sketch', sketchId },
          loops: [{
            loopId: `region_loop_${sketchId}_outer` as const,
            role: 'outer',
            orientation: 'counterClockwise',
            segments: entities.map((entity, index) => ({
              source: { kind: 'entity' as const, entityId: entity.entityId },
              startPointId: points[index]!.id,
              endPointId: points[(index + 1) % points.length]!.id,
            })),
            boundaryPointIds: points.map((point) => point.id),
            isClosed: true,
          }],
          isClosed: true,
        }],
      ),
      regionId,
    }
  }

  function findPlanarFaceByAxis(
    oc: Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>,
    body: NonNullable<ReturnType<typeof rebuildOccAuthoringState>['bodies'][number]>,
    axis: 'y' | 'z',
    coordinate: number,
  ) {
    const axisIndex = axis === 'y' ? 1 : 2
    const faceId = body.topology.faceIds.find((candidate) => {
      const face = body.facesById.get(candidate)
      if (!face) {
        return false
      }

      const plane = extractPlanarFaceData(oc, face)
      return Math.abs(Math.abs(plane.frame.normal[axisIndex]) - 1) < 0.001
        && Math.abs(plane.frame.origin[axisIndex] - coordinate) < 0.001
    })

    assert(faceId, `Expected body ${body.bodyId} to expose a planar face at ${axis}=${coordinate}.`)
    return faceId
  }

  const oc = await getDefaultOpenCascadeInstance()
  const plane = createStandardPlaneDefinition('xy')
  const sketchId = 'sketch_timeline_shell_highlight' as SketchId
  const { sketch, regionId } = createRectangleSketch(sketchId, plane)
  const extrudeFeatureId = 'feature_timeline_shell_extrude' as FeatureId
  const shellFeatureId = 'feature_timeline_shell' as FeatureId
  const extrudeDefinition: FeatureDefinition = {
    kind: 'extrude',
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      profiles: [{ kind: 'region', sketchId, regionId }],
      startExtent: { kind: 'profilePlane' },
      endExtent: { kind: 'blind', direction: 'positive', distance: 6 },
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    },
  }
  const initialState = createOccAuthoringState(oc, { sketches: [sketch] })
  const extrudeState = rebuildOccAuthoringState(initialState, [{
    featureId: extrudeFeatureId,
    label: 'Extrude 1',
    definition: extrudeDefinition,
  }])
  const extrudeBody = extrudeState.bodies[0]

  assert(extrudeBody, 'Timeline highlight coverage requires the extrude body to exist.')

  const removableFaceId = findPlanarFaceByAxis(oc, extrudeBody, 'z', 6)
  const shellDefinition: FeatureDefinition = {
    kind: 'shell',
    featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
    parameters: {
      bodyTarget: { kind: 'body', bodyId: extrudeBody.bodyId },
      faceTargets: [{ kind: 'face', bodyId: extrudeBody.bodyId, faceId: removableFaceId }],
      thickness: 1,
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    },
  }
  const authoredFeatures = [
    {
      featureId: extrudeFeatureId,
      label: 'Extrude 1',
      definition: extrudeDefinition,
    },
    {
      featureId: shellFeatureId,
      label: 'Shell 1',
      definition: shellDefinition,
    },
  ] as const
  const shelledState = rebuildOccAuthoringState(initialState, authoredFeatures)
  const shelledBody = shelledState.bodies.find((body) => body.ownerFeatureId === shellFeatureId)

  assert(shelledBody, 'Timeline highlight coverage requires the shelled body to exist.')

  const innerShellFaceTarget: PrimitiveRef = {
    kind: 'face',
    bodyId: shelledBody.bodyId,
    faceId: findPlanarFaceByAxis(oc, shelledBody, 'y', 7),
  }
  const preservedBackFaceTarget: PrimitiveRef = {
    kind: 'face',
    bodyId: shelledBody.bodyId,
    faceId: findPlanarFaceByAxis(oc, shelledBody, 'y', 8),
  }
  const snapshot = buildOccWorkspaceSnapshot(shelledState)
  const editorValue = {
    machineState: initialEditorState,
    state: {
      ...getEditorViewState(initialEditorState),
      selectionCatalog: {
        selectableTargetKeys: snapshot.presentation.entities.map((entity) => getPrimitiveRefKey(entity.target)),
        existingSketchKeys: snapshot.presentation.entities
          .filter((entity) => entity.selectionSemantics.includes('existingSketch'))
          .map((entity) => getPrimitiveRefKey(entity.target)),
        constructionPlaneKeys: snapshot.presentation.entities
          .filter((entity) => entity.selectionSemantics.includes('constructionPlane'))
          .map((entity) => getPrimitiveRefKey(entity.target)),
        planarFaceKeys: snapshot.presentation.entities
          .filter((entity) => entity.selectionSemantics.includes('planarFace'))
          .map((entity) => getPrimitiveRefKey(entity.target)),
      },
    },
    dispatch: () => undefined,
  }

  function renderMarkup(selectedTarget: PrimitiveRef | null) {
    const historyHighlightFeatureIds = getTargetContributingFeatureIds(snapshot, selectedTarget)

    return renderToStaticMarkup(
      <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
        <EditorContext.Provider value={editorValue}>
          <FeatureTimelineBar
            snapshot={snapshot}
            historyHighlightFeatureIds={historyHighlightFeatureIds}
            visibleSelection={selectedTarget ? [selectedTarget] : []}
            onSelectTarget={() => undefined}
            onReopenTarget={() => undefined}
            onCursorRequested={() => undefined}
            onDeleteItem={() => undefined}
            onRenameItem={() => undefined}
            onSuppressFeature={() => undefined}
          />
        </EditorContext.Provider>
      </MantineProvider>,
    )
  }

  const innerFaceMarkup = renderMarkup(innerShellFaceTarget)
  const preservedFaceMarkup = renderMarkup(preservedBackFaceTarget)
  const deselectedMarkup = renderMarkup(null)
  const hasHighlightedFeature = (markup: string, featureId: FeatureId) =>
    new RegExp(`data-derived-highlighted="true"[^>]*data-history-feature-id="${featureId}"|data-history-feature-id="${featureId}"[^>]*data-derived-highlighted="true"`).test(markup)

  assert(
    hasHighlightedFeature(innerFaceMarkup, extrudeFeatureId),
    'Selecting an inner shell face should highlight the upstream extrude history item.',
  )
  assert(
    hasHighlightedFeature(innerFaceMarkup, shellFeatureId),
    'Selecting an inner shell face should highlight the downstream shell history item.',
  )
  assert(
    hasHighlightedFeature(preservedFaceMarkup, extrudeFeatureId),
    'Selecting a preserved back face should keep the extrude history item highlighted.',
  )
  assert(
    !hasHighlightedFeature(preservedFaceMarkup, shellFeatureId),
    'Selecting a preserved back face should not highlight the unrelated shell history item.',
  )
  assert(
    !deselectedMarkup.includes('data-derived-highlighted="true"'),
    'Clearing selection should remove every derived history highlight.',
  )
})

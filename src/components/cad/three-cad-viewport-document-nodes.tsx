import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import type { SketchRenderingPalette } from '@/components/cad/sketch-rendering-palette'
import {
  MARKER_SPHERE_GEOMETRY,
  GEOMETRY_HIGHLIGHT_COLORS,
  applyWireMaterialDepthPolicy,
  bindFaceHoverPerimeterObject,
  bindRenderableObject,
  createMeshBoundaryLineSegmentsGeometry,
  createMarkerPickProxy,
  createRenderableLineMaterial,
  createRenderableMarkerMaterial,
  createRenderableMeshMaterial,
  getRenderableRenderOrder,
  getVisibleMarkerRadius,
  isSeededDatumPlaneRenderable,
} from '@/domain/workspace/render-picking'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'

function getDocumentRenderableMaterialOptions(
  entry: ViewportRenderableRecord,
  palette: SketchRenderingPalette,
  diagnostic = false,
) {
  const semanticClass = entry.renderable.binding.semanticClass
  const display = entry.sketchConstraintDisplay

  if (semanticClass === 'region') {
    return { color: palette.regionFill, flat: true }
  }

  if (semanticClass !== 'sketchCurve' && semanticClass !== 'sketchPoint') {
    return {}
  }

  if (diagnostic) {
    return { color: palette.overconstrained, flat: true }
  }

  if (semanticClass === 'sketchPoint' && display?.isAffectedOverconstraint) {
    return { color: palette.overconstrained, flat: true }
  }

  if (display?.state === 'constrained') {
    return { color: palette.constrained, flat: true }
  }

  return { color: palette.underconstrained, flat: true }
}

export function DocumentRenderableNode({
  entry,
  palette,
  clippingPlane,
}: {
  entry: ViewportRenderableRecord
  palette: SketchRenderingPalette
  clippingPlane: THREE.Plane | null
}) {
  switch (entry.renderable.geometry.kind) {
    case 'mesh':
      return <DocumentMeshNode entry={entry} palette={palette} clippingPlane={clippingPlane} />
    case 'polyline':
      return (
        <>
          <DocumentPolylineNode entry={entry} palette={palette} />
          {entry.sketchConstraintDisplay?.isAffectedOverconstraint
            ? <DocumentPolylineNode entry={entry} palette={palette} diagnostic />
            : null}
        </>
      )
    case 'marker':
      return <DocumentMarkerNode entry={entry} palette={palette} />
  }
}

export function DocumentMeshNode({
  entry,
  palette,
  clippingPlane,
}: {
  entry: ViewportRenderableRecord
  palette: SketchRenderingPalette
  clippingPlane: THREE.Plane | null
}) {
  const { renderable, origin } = entry
  const geometryData = renderable.geometry.kind === 'mesh' ? renderable.geometry : null
  const geometry = useMemo(() => {
    if (!geometryData) {
      throw new Error(`Renderable ${renderable.id} is missing mesh geometry.`)
    }

    const nextGeometry = new THREE.BufferGeometry()
    nextGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(geometryData.vertexPositions.flat(), 3),
    )
    nextGeometry.setIndex(geometryData.triangleIndices.flat())
    if (geometryData.vertexNormals) {
      nextGeometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(geometryData.vertexNormals.flat(), 3),
      )
    } else {
      nextGeometry.computeVertexNormals()
    }
    return nextGeometry
  }, [geometryData, renderable.id])
  const material = useMemo(() => {
    const nextMaterial = isSeededDatumPlaneRenderable(renderable)
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
      : createRenderableMeshMaterial(renderable, origin, getDocumentRenderableMaterialOptions(entry, palette))

    if (clippingPlane) {
      nextMaterial.clippingPlanes = [clippingPlane]
      nextMaterial.clipShadows = true
      nextMaterial.needsUpdate = true
    }

    return nextMaterial
  }, [clippingPlane, entry, origin, palette, renderable])
  const facePerimeterGeometry = useMemo(() => {
    if (
      !geometryData
      || (renderable.binding.semanticClass !== 'bodyFace' && renderable.binding.semanticClass !== 'planarFace')
    ) {
      return null
    }

    return createMeshBoundaryLineSegmentsGeometry(geometryData)
  }, [geometryData, renderable.binding.semanticClass])
  const facePerimeterMaterial = useMemo(() => {
    if (!facePerimeterGeometry) {
      return null
    }

    return applyWireMaterialDepthPolicy(new THREE.LineBasicMaterial({
      color: GEOMETRY_HIGHLIGHT_COLORS.hover,
      transparent: true,
      opacity: 0,
    }))
  }, [facePerimeterGeometry])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => facePerimeterGeometry?.dispose(), [facePerimeterGeometry])
  useEffect(() => () => facePerimeterMaterial?.dispose(), [facePerimeterMaterial])
  const renderOrder = isSeededDatumPlaneRenderable(renderable)
    ? 1
    : getRenderableRenderOrder(renderable, origin)

  return (
    <group>
      <mesh
        ref={(value) => {
          if (value) {
            bindRenderableObject(
              value,
              renderable.binding.pickId,
              renderable.binding.target,
              renderable.binding.semanticClass,
              origin,
              renderable,
            )
          }
        }}
        geometry={geometry}
        material={material}
        renderOrder={renderOrder}
      />
      {facePerimeterGeometry && facePerimeterMaterial ? (
        <lineSegments
          ref={(value) => {
            if (value) {
              bindFaceHoverPerimeterObject(
                value,
                renderable.binding.target,
                renderable.binding.semanticClass as 'bodyFace' | 'planarFace',
                origin,
              )
            }
          }}
          geometry={facePerimeterGeometry}
          material={facePerimeterMaterial}
          renderOrder={renderOrder + 1}
        />
      ) : null}
    </group>
  )
}

export function DocumentPolylineNode({
  entry,
  palette,
  diagnostic = false,
}: {
  entry: ViewportRenderableRecord
  palette: SketchRenderingPalette
  diagnostic?: boolean
}) {
  const { renderable, origin } = entry
  const geometryData = renderable.geometry.kind === 'polyline' ? renderable.geometry : null
  const line = useMemo(() => {
    if (!geometryData) {
      throw new Error(`Renderable ${renderable.id} is missing polyline geometry.`)
    }

    const points = geometryData.points.map((point) => new THREE.Vector3(point[0], point[1], point[2]))
    const displayPoints = geometryData.isClosed && points.length > 0 ? [...points, points[0].clone()] : points
    const nextGeometry = new THREE.BufferGeometry().setFromPoints(displayPoints)
    const nextMaterial = isSeededDatumPlaneRenderable(renderable)
      ? applyWireMaterialDepthPolicy(new THREE.LineBasicMaterial({
          color: 0x7f8a98,
          transparent: true,
          opacity: 0.4,
        }))
      : createRenderableLineMaterial(renderable, origin, getDocumentRenderableMaterialOptions(entry, palette, diagnostic))
    const nextLine = new THREE.Line(nextGeometry, nextMaterial)
    nextLine.renderOrder = isSeededDatumPlaneRenderable(renderable)
      ? 2
      : getRenderableRenderOrder(renderable, origin)
    bindRenderableObject(
      nextLine,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      origin,
      renderable,
    )
    return nextLine
  }, [diagnostic, entry, geometryData, origin, palette, renderable])

  useEffect(() => {
    return () => {
      line.geometry.dispose()
      if (Array.isArray(line.material)) {
        line.material.forEach((material) => material.dispose())
      } else {
        line.material.dispose()
      }
    }
  }, [line])

  return <primitive object={line} />
}

export function DocumentMarkerNode({
  entry,
  palette,
}: {
  entry: ViewportRenderableRecord
  palette: SketchRenderingPalette
}) {
  const { renderable, origin } = entry
  const geometryData = renderable.geometry.kind === 'marker' ? renderable.geometry : null
  const pickProxy = useMemo(() => {
    if (!geometryData) {
      throw new Error('Renderable is missing marker geometry.')
    }

    const proxy = createMarkerPickProxy(geometryData.position, geometryData.displayRadius)
    proxy.userData.highlightExcluded = true
    return proxy
  }, [geometryData])
  const material = useMemo(
    () => createRenderableMarkerMaterial(renderable, origin, getDocumentRenderableMaterialOptions(entry, palette)),
    [entry, origin, palette, renderable],
  )

  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    const proxyMaterial = pickProxy.material

    return () => {
      if (proxyMaterial instanceof THREE.Material) {
        proxyMaterial.dispose()
      }
    }
  }, [pickProxy])
  return (
    <group
      ref={(value) => {
        if (value) {
          bindRenderableObject(
            value,
            renderable.binding.pickId,
            renderable.binding.target,
            renderable.binding.semanticClass,
            origin,
            renderable,
          )
        }
      }}
      renderOrder={getRenderableRenderOrder(renderable, origin)}
    >
      <mesh
        geometry={MARKER_SPHERE_GEOMETRY}
        material={material}
        position={geometryData?.position}
        scale={geometryData ? getVisibleMarkerRadius(geometryData.displayRadius) : 1}
        renderOrder={getRenderableRenderOrder(renderable, origin)}
      />
      <primitive object={pickProxy} />
    </group>
  )
}

import * as THREE from 'three'
import { SVGLoader } from 'three-stdlib'

import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import { SURFACE_COLORS } from '@/infrastructure/viewport/render-picking'
import type { ToolbarMode } from '@/core/tools/schema'
import type { SketchRenderingPalette } from '@/components/cad/sketch-rendering-palette'
import type { SketchPlaneFrame } from '@/contracts/shared/sketch-plane'

export interface SketchDisplayMeshMaterialConfig {
  fill: SketchDisplayMeshFillConfig
  color: number
  transparent: boolean
  opacity: number
  side: THREE.Side
  polygonOffset: boolean
  polygonOffsetFactor: number
  polygonOffsetUnits: number
  sketchPlaneFrame?: SketchPlaneFrame
}

export type SketchDisplayMeshFillConfig =
  | {
      kind: 'solid'
      color: number
      opacity: number
    }
  | {
      kind: 'linearGradient'
      startColor: number
      startOpacity: number
      endColor: number
      endOpacity: number
      angleRadians: number
      fallbackColor: number
      fallbackOpacity: number
    }

export interface SketchDisplayPolylineMaterialConfig {
  linePattern: SketchSessionDisplayRenderable['linePattern']
  color: number
  opacity: number
  lineWidth: number
  lineCap: 'butt' | 'round' | 'square'
  lineJoin: 'miter' | 'round' | 'bevel'
  miterLimit: number
  dashSize: number
  gapSize: number
}

export interface SketchDisplayMarkerMaterialConfig {
  color: number
  transparent: boolean
  opacity: number
}

export function shouldDepthTestSketchDisplayMarker(renderable: SketchSessionDisplayRenderable) {
  return renderable.markerLayer !== 'overlay'
}

export function getSketchDisplayMarkerRenderOrder(renderable: SketchSessionDisplayRenderable) {
  return renderable.markerLayer === 'overlay' ? 5 : 4
}

export function shouldApplySketchDisplayStyles(mode: ToolbarMode, hasSketchSession: boolean) {
  return mode === 'sketch' && hasSketchSession
}

export function getSketchDisplayMeshMaterialConfig(
  renderable: SketchSessionDisplayRenderable,
  applyStyles: boolean,
  palette: SketchRenderingPalette,
): SketchDisplayMeshMaterialConfig {
  const defaultColor = renderable.semanticClass === 'region'
    ? palette.regionFill
    : renderable.role === 'reference' ? SURFACE_COLORS.sketchReference : getDefaultSketchConstraintColor(renderable, palette)
  const defaultOpacity = renderable.semanticClass === 'region' ? 0.22 : 0.24
  const color = applyStyles ? renderable.paintStyle?.color ?? defaultColor : defaultColor
  const opacity = applyStyles ? renderable.paintStyle?.opacity ?? defaultOpacity : defaultOpacity
  const fill = applyStyles && renderable.paintStyle?.kind === 'linearGradient'
    ? {
        kind: 'linearGradient' as const,
        startColor: renderable.paintStyle.startColor,
        startOpacity: renderable.paintStyle.startOpacity,
        endColor: renderable.paintStyle.endColor,
        endOpacity: renderable.paintStyle.endOpacity,
        angleRadians: renderable.paintStyle.angleRadians,
        fallbackColor: renderable.paintStyle.color,
        fallbackOpacity: renderable.paintStyle.opacity,
      }
    : {
        kind: 'solid' as const,
        color,
        opacity,
      }

  return {
    fill,
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    polygonOffset: renderable.semanticClass === 'region',
    polygonOffsetFactor: renderable.semanticClass === 'region' ? -2 : 0,
    polygonOffsetUnits: renderable.semanticClass === 'region' ? -2 : 0,
    sketchPlaneFrame: renderable.sketchPlaneFrame,
  }
}

export function getSketchDisplayPolylineMaterialConfig(
  renderable: SketchSessionDisplayRenderable,
  applyStyles: boolean,
  palette: SketchRenderingPalette,
): SketchDisplayPolylineMaterialConfig {
  const isDiagnostic = renderable.diagnosticStyle?.kind === 'overconstraint'
  const defaultColor = renderable.role === 'reference'
    ? SURFACE_COLORS.sketchReference
    : isDiagnostic
      ? palette.overconstrained
      : getDefaultSketchConstraintColor(renderable, palette)
  const hasAuthoredDash = applyStyles
    && (renderable.strokeStyle?.dashSize ?? 0) > 0
    && (renderable.strokeStyle?.gapSize ?? 0) > 0
  const linePattern = isDiagnostic ? 'solid' : hasAuthoredDash ? 'dashed' : renderable.linePattern
  const defaultOpacity = linePattern === 'dashed'
    ? (renderable.role === 'reference' ? 0.7 : 0.88)
    : 0.95

  return {
    linePattern,
    color: isDiagnostic ? defaultColor : applyStyles ? renderable.strokeStyle?.color ?? defaultColor : defaultColor,
    opacity: isDiagnostic ? 1 : applyStyles ? renderable.strokeStyle?.opacity ?? defaultOpacity : defaultOpacity,
    lineWidth: isDiagnostic ? 1 : applyStyles ? renderable.strokeStyle?.width ?? 1 : 1,
    lineCap: isDiagnostic ? 'round' : applyStyles ? renderable.strokeStyle?.lineCap ?? 'round' : 'round',
    lineJoin: isDiagnostic ? 'round' : applyStyles ? renderable.strokeStyle?.lineJoin ?? 'round' : 'round',
    miterLimit: isDiagnostic ? 4 : applyStyles ? renderable.strokeStyle?.miterLimit ?? 4 : 4,
    dashSize: isDiagnostic ? 0.24 : applyStyles ? renderable.strokeStyle?.dashSize ?? 0.24 : 0.24,
    gapSize: isDiagnostic ? 0.14 : applyStyles ? renderable.strokeStyle?.gapSize ?? 0.14 : 0.14,
  }
}

export function shouldUseSketchStrokeMeshGeometry(
  renderable: SketchSessionDisplayRenderable,
  materialConfig: SketchDisplayPolylineMaterialConfig,
  applyStyles: boolean,
) {
  return applyStyles
    && renderable.geometry.kind === 'polyline'
    && renderable.strokeStyle !== undefined
    && renderable.diagnosticStyle === undefined
    && materialConfig.lineWidth > 0
}

export interface BuildSketchPolylineStrokeGeometryInput {
  points: readonly (readonly [number, number, number])[]
  isClosed: boolean
  materialConfig: SketchDisplayPolylineMaterialConfig
  worldUnitsPerPixel: number
  sketchPlaneFrame?: SketchPlaneFrame
}

export function buildSketchPolylineStrokeGeometry(input: BuildSketchPolylineStrokeGeometryInput): THREE.BufferGeometry {
  const frame = createStrokeProjectionFrame(input.points, input.sketchPlaneFrame)
  const projectedPoints = input.points.map((point) => projectWorldPointToStrokeFrame(point, frame))
  const strokeWidth = Math.max(input.materialConfig.lineWidth * input.worldUnitsPerPixel, 1e-6)
  const dashSize = Math.max(input.materialConfig.dashSize * input.worldUnitsPerPixel, 0)
  const gapSize = Math.max(input.materialConfig.gapSize * input.worldUnitsPerPixel, 0)
  const strokeStyle = SVGLoader.getStrokeStyle(
    strokeWidth,
    `#${input.materialConfig.color.toString(16).padStart(6, '0')}`,
    input.materialConfig.lineJoin,
    input.materialConfig.lineCap,
    input.materialConfig.miterLimit,
  )
  const strokeSegments = input.materialConfig.linePattern === 'dashed' && dashSize > 0 && gapSize > 0
    ? splitSketchPolylineDashSegments(projectedPoints, dashSize, gapSize, input.isClosed)
    : [getSvgStrokePathPoints(projectedPoints, input.isClosed)]
  const positions: number[] = []

  for (const segment of strokeSegments) {
    if (segment.length < 2) {
      continue
    }

    const segmentGeometry = SVGLoader.pointsToStroke([...segment], strokeStyle, 16, 1e-6)
    if (!segmentGeometry) {
      continue
    }

    const segmentPosition = segmentGeometry.getAttribute('position')
    for (let index = 0; index < segmentPosition.count; index += 1) {
      const worldPoint = unprojectStrokeFramePoint(
        new THREE.Vector2(segmentPosition.getX(index), segmentPosition.getY(index)),
        frame,
      )
      positions.push(worldPoint.x, worldPoint.y, worldPoint.z)
    }
    segmentGeometry.dispose()
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function splitSketchPolylineDashSegments(
  points: readonly THREE.Vector2[],
  dashSize: number,
  gapSize: number,
  isClosed: boolean,
): THREE.Vector2[][] {
  const pathPoints = getSvgStrokePathPoints(points, isClosed)
  if (pathPoints.length < 2 || dashSize <= 0 || gapSize <= 0) {
    return []
  }

  const dashSegments: THREE.Vector2[][] = []
  let isDash = true
  let remainingPatternLength = dashSize
  let activeDash: THREE.Vector2[] = [pathPoints[0]!.clone()]

  for (let pointIndex = 1; pointIndex < pathPoints.length; pointIndex += 1) {
    let cursor = pathPoints[pointIndex - 1]!.clone()
    const segmentEnd = pathPoints[pointIndex]!
    const segmentLength = cursor.distanceTo(segmentEnd)
    if (segmentLength <= 1e-9) {
      continue
    }

    const direction = segmentEnd.clone().sub(cursor).divideScalar(segmentLength)
    let remainingSegmentLength = segmentLength
    while (remainingSegmentLength > 1e-9) {
      const step = Math.min(remainingPatternLength, remainingSegmentLength)
      const next = cursor.clone().addScaledVector(direction, step)

      if (isDash) {
        if (activeDash.length === 0) {
          activeDash.push(cursor.clone())
        }
        activeDash.push(next.clone())
      }

      cursor = next
      remainingSegmentLength -= step
      remainingPatternLength -= step

      if (remainingPatternLength <= 1e-9) {
        if (isDash && activeDash.length >= 2) {
          dashSegments.push(activeDash)
        }
        isDash = !isDash
        remainingPatternLength = isDash ? dashSize : gapSize
        activeDash = isDash ? [cursor.clone()] : []
      }
    }
  }

  if (isDash && activeDash.length >= 2) {
    dashSegments.push(activeDash)
  }

  return dashSegments
}

export function getSketchStrokeWorldUnitsPerPixel(
  camera: THREE.Camera,
  viewportHeight: number,
  points: readonly (readonly [number, number, number])[],
) {
  if (viewportHeight <= 0) {
    return 1
  }

  if (camera instanceof THREE.OrthographicCamera) {
    return (camera.top - camera.bottom) / camera.zoom / viewportHeight
  }

  if (camera instanceof THREE.PerspectiveCamera) {
    const center = getPointsCenter(points)
    const cameraPosition = new THREE.Vector3()
    camera.getWorldPosition(cameraPosition)
    const distance = cameraPosition.distanceTo(center)
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewportHeight
  }

  return 1
}

export function buildSketchGradientMeshMaterial(config: SketchDisplayMeshMaterialConfig) {
  if (config.fill.kind !== 'linearGradient') {
    return new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: config.transparent,
      opacity: config.opacity,
      side: config.side,
      polygonOffset: config.polygonOffset,
      polygonOffsetFactor: config.polygonOffsetFactor,
      polygonOffsetUnits: config.polygonOffsetUnits,
    })
  }

  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: config.side,
    polygonOffset: config.polygonOffset,
    polygonOffsetFactor: config.polygonOffsetFactor,
    polygonOffsetUnits: config.polygonOffsetUnits,
    depthWrite: false,
    uniforms: {
      startColor: { value: new THREE.Color(config.fill.startColor) },
      endColor: { value: new THREE.Color(config.fill.endColor) },
      startOpacity: { value: config.fill.startOpacity },
      endOpacity: { value: config.fill.endOpacity },
      gradientOrigin: { value: new THREE.Vector3() },
      gradientVector: { value: new THREE.Vector3(Math.cos(config.fill.angleRadians), Math.sin(config.fill.angleRadians), 0) },
      gradientLengthSquared: { value: 1 },
    },
    vertexShader: `
      varying float vGradientT;
      uniform vec3 gradientOrigin;
      uniform vec3 gradientVector;
      uniform float gradientLengthSquared;

      void main() {
        vec3 localPosition = position - gradientOrigin;
        vGradientT = clamp(dot(localPosition, gradientVector) / gradientLengthSquared, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vGradientT;
      uniform vec3 startColor;
      uniform vec3 endColor;
      uniform float startOpacity;
      uniform float endOpacity;

      void main() {
        vec3 color = mix(startColor, endColor, vGradientT);
        float alpha = mix(startOpacity, endOpacity, vGradientT);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })
  return material
}

export function updateSketchGradientMaterialFrame(
  material: THREE.Material,
  geometry: THREE.BufferGeometry,
  config: SketchDisplayMeshMaterialConfig,
) {
  if (!(material instanceof THREE.ShaderMaterial) || config.fill.kind !== 'linearGradient') {
    return
  }

  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  if (!bounds) {
    return
  }

  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const direction = getGradientDirection(config.fill.angleRadians, config.sketchPlaneFrame)
  const halfLength = Math.max(
    Math.abs(direction.x) * size.x + Math.abs(direction.y) * size.y + Math.abs(direction.z) * size.z,
    1e-6,
  ) / 2
  const unitDirection = direction.clone().normalize()
  const gradientVector = unitDirection.clone().multiplyScalar(halfLength * 2)
  const origin = center.clone().addScaledVector(unitDirection, -halfLength)

  material.uniforms.gradientOrigin.value.copy(origin)
  material.uniforms.gradientVector.value.copy(gradientVector)
  material.uniforms.gradientLengthSquared.value = Math.max(gradientVector.lengthSq(), 1e-12)
}

function getSvgStrokePathPoints(points: readonly THREE.Vector2[], isClosed: boolean): THREE.Vector2[] {
  if (!isClosed || points.length === 0) {
    return points.map((point) => point.clone())
  }

  const first = points[0]!
  const last = points[points.length - 1]!
  return first.distanceTo(last) <= 1e-9
    ? points.map((point) => point.clone())
    : [...points.map((point) => point.clone()), first.clone()]
}

interface StrokeProjectionFrame {
  origin: THREE.Vector3
  xAxis: THREE.Vector3
  yAxis: THREE.Vector3
}

function createStrokeProjectionFrame(
  points: readonly (readonly [number, number, number])[],
  sketchPlaneFrame: SketchPlaneFrame | undefined,
): StrokeProjectionFrame {
  if (sketchPlaneFrame) {
    return {
      origin: vectorFromTuple(sketchPlaneFrame.origin),
      xAxis: vectorFromTuple(sketchPlaneFrame.xAxis).normalize(),
      yAxis: vectorFromTuple(sketchPlaneFrame.yAxis).normalize(),
    }
  }

  const origin = points[0] ? vectorFromTuple(points[0]) : new THREE.Vector3()
  const xAxis = getFirstSegmentDirection(points) ?? new THREE.Vector3(1, 0, 0)
  const normal = getFirstNonCollinearNormal(points, xAxis) ?? getFallbackNormal(xAxis)
  const yAxis = normal.clone().cross(xAxis).normalize()
  return { origin, xAxis, yAxis }
}

function projectWorldPointToStrokeFrame(point: readonly [number, number, number], frame: StrokeProjectionFrame) {
  const delta = vectorFromTuple(point).sub(frame.origin)
  return new THREE.Vector2(delta.dot(frame.xAxis), delta.dot(frame.yAxis))
}

function unprojectStrokeFramePoint(point: THREE.Vector2, frame: StrokeProjectionFrame) {
  return frame.origin.clone()
    .addScaledVector(frame.xAxis, point.x)
    .addScaledVector(frame.yAxis, point.y)
}

function getGradientDirection(angleRadians: number, sketchPlaneFrame: SketchPlaneFrame | undefined) {
  const x = Math.cos(angleRadians)
  const y = Math.sin(angleRadians)
  if (!sketchPlaneFrame) {
    return new THREE.Vector3(x, y, 0).normalize()
  }

  return vectorFromTuple(sketchPlaneFrame.xAxis)
    .multiplyScalar(x)
    .addScaledVector(vectorFromTuple(sketchPlaneFrame.yAxis), y)
    .normalize()
}

function getFirstSegmentDirection(points: readonly (readonly [number, number, number])[]) {
  for (let index = 1; index < points.length; index += 1) {
    const direction = vectorFromTuple(points[index]!).sub(vectorFromTuple(points[index - 1]!))
    if (direction.lengthSq() > 1e-12) {
      return direction.normalize()
    }
  }

  return null
}

function getFirstNonCollinearNormal(
  points: readonly (readonly [number, number, number])[],
  xAxis: THREE.Vector3,
) {
  if (points.length < 3 || !points[0]) {
    return null
  }

  const origin = vectorFromTuple(points[0])
  for (let index = 2; index < points.length; index += 1) {
    const candidate = vectorFromTuple(points[index]!).sub(origin)
    const normal = xAxis.clone().cross(candidate)
    if (normal.lengthSq() > 1e-12) {
      return normal.normalize()
    }
  }

  return null
}

function getFallbackNormal(xAxis: THREE.Vector3) {
  const zAxis = new THREE.Vector3(0, 0, 1)
  if (Math.abs(xAxis.dot(zAxis)) < 0.99) {
    return zAxis
  }

  return new THREE.Vector3(0, 1, 0)
}

function getPointsCenter(points: readonly (readonly [number, number, number])[]) {
  if (points.length === 0) {
    return new THREE.Vector3()
  }

  const center = new THREE.Vector3()
  for (const point of points) {
    center.add(vectorFromTuple(point))
  }
  return center.divideScalar(points.length)
}

function vectorFromTuple(point: readonly [number, number, number]) {
  return new THREE.Vector3(point[0], point[1], point[2])
}

export function getSketchDisplayMarkerMaterialConfig(
  renderable: SketchSessionDisplayRenderable,
  applyStyles: boolean,
  palette: SketchRenderingPalette,
): SketchDisplayMarkerMaterialConfig {
  const defaultColor = renderable.role === 'reference'
    ? SURFACE_COLORS.sketchReference
    : renderable.constraintDisplay?.isAffectedOverconstraint
      ? palette.overconstrained
      : getDefaultSketchConstraintColor(renderable, palette)

  return {
    color: applyStyles
      ? renderable.paintStyle?.color ?? renderable.strokeStyle?.color ?? defaultColor
      : defaultColor,
    transparent: applyStyles && (
      renderable.paintStyle?.opacity !== undefined || renderable.strokeStyle?.opacity !== undefined
    ),
    opacity: applyStyles ? renderable.paintStyle?.opacity ?? renderable.strokeStyle?.opacity ?? 1 : 1,
  }
}

function getDefaultSketchConstraintColor(
  renderable: SketchSessionDisplayRenderable,
  palette: SketchRenderingPalette,
) {
  switch (renderable.constraintDisplay?.state) {
    case 'constrained':
      return palette.constrained
    case 'overconstrained':
      return renderable.constraintDisplay.isAffectedOverconstraint
        ? palette.underconstrained
        : palette.underconstrained
    case 'underconstrained':
    case undefined:
      return palette.underconstrained
  }
}

import * as THREE from 'three'

import {
  VIEW_CUBE_CORNER_TARGETS,
  VIEW_CUBE_FACE_TARGETS,
} from '@/infrastructure/viewport/view-cube-navigation'
import type {
  ViewNavigationCornerPresetId,
  ViewNavigationFacePresetId,
  ViewNavigationPresetId,
} from '@/infrastructure/viewport/view-navigation'

export const VIEW_CUBE_BODY_HALF_SIZE = 0.58
export const VIEW_CUBE_SURFACE_OFFSET = 0.002
export const VIEW_CUBE_LABEL_OFFSET = 0.03
export const VIEW_CUBE_CORNER_CUT_SIZE = 0.30

export interface ViewCubeFaceVisual {
  presetId: ViewNavigationFacePresetId
  normal: THREE.Vector3
  outlineMaterial: THREE.LineBasicMaterial
  labelMaterial: THREE.MeshBasicMaterial
  labelTexture: THREE.Texture
}

export interface ViewCubeCornerVisual {
  presetId: ViewNavigationCornerPresetId
  outlineMaterial: THREE.LineBasicMaterial
  faceGeometry: THREE.BufferGeometry
  outlineGeometry: THREE.BufferGeometry
  hitGeometry: THREE.BufferGeometry
}

export interface ViewCubeSceneState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  interactiveObjects: THREE.Object3D[]
  faceVisuals: ViewCubeFaceVisual[]
  cornerVisuals: ViewCubeCornerVisual[]
  dispose: () => void
}

export function createViewCubeScene(): ViewCubeSceneState {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  const interactiveObjects: THREE.Object3D[] = []
  const faceVisuals: ViewCubeFaceVisual[] = []
  const cornerVisuals: ViewCubeCornerVisual[] = []

  scene.add(new THREE.AmbientLight(0xffffff, 1.1))

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9)
  directionalLight.position.set(3, 4, 6)
  scene.add(directionalLight)

  const cubeGroup = new THREE.Group()
  scene.add(cubeGroup)

  const faceFillGeometry = createViewCubeFaceGeometry(VIEW_CUBE_BODY_HALF_SIZE, VIEW_CUBE_CORNER_CUT_SIZE)
  const faceFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x314255,
  })
  const faceOutlineGeometry = createViewCubeFaceOutlineGeometry(VIEW_CUBE_BODY_HALF_SIZE, VIEW_CUBE_CORNER_CUT_SIZE)
  const faceHitGeometry = createViewCubeFaceGeometry(VIEW_CUBE_BODY_HALF_SIZE, VIEW_CUBE_CORNER_CUT_SIZE)
  const faceLabelGeometry = new THREE.PlaneGeometry(1.08, 0.54)
  const faceHitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  for (const faceTarget of VIEW_CUBE_FACE_TARGETS) {
    const faceNormal = new THREE.Vector3(...faceTarget.position).normalize()
    const faceSurfacePosition = faceNormal.clone().multiplyScalar(VIEW_CUBE_BODY_HALF_SIZE)
    const faceControlPosition = faceNormal.clone().multiplyScalar(VIEW_CUBE_BODY_HALF_SIZE + VIEW_CUBE_SURFACE_OFFSET)
    const fill = new THREE.Mesh(faceFillGeometry, faceFillMaterial)
    fill.position.copy(faceSurfacePosition)
    applyViewCubeRotation(fill, faceTarget.rotation)
    cubeGroup.add(fill)

    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x8db7ff,
      transparent: true,
      opacity: 0.5,
    })
    const outline = new THREE.LineLoop(faceOutlineGeometry, outlineMaterial)
    outline.position.copy(faceControlPosition)
    applyViewCubeRotation(outline, faceTarget.rotation)
    cubeGroup.add(outline)

    const label = createViewCubeLabelMesh(faceTarget.label, faceLabelGeometry)
    label.mesh.position.copy(faceNormal.clone().multiplyScalar(VIEW_CUBE_BODY_HALF_SIZE + VIEW_CUBE_LABEL_OFFSET))
    label.mesh.quaternion.copy(
      createViewCubePlaneQuaternion(
        faceNormal,
        new THREE.Vector3(...faceTarget.labelUp),
      ),
    )
    cubeGroup.add(label.mesh)

    const hitTarget = new THREE.Mesh(faceHitGeometry, faceHitMaterial)
    hitTarget.position.copy(faceControlPosition)
    applyViewCubeRotation(hitTarget, faceTarget.rotation)
    hitTarget.userData.presetId = faceTarget.presetId
    cubeGroup.add(hitTarget)
    interactiveObjects.push(hitTarget)

    faceVisuals.push({
      presetId: faceTarget.presetId,
      normal: faceNormal,
      outlineMaterial,
      labelMaterial: label.material,
      labelTexture: label.texture,
    })
  }

  const cornerFaceMaterial = new THREE.MeshBasicMaterial({
    color: 0x314255,
  })
  const cornerHitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  for (const cornerTarget of VIEW_CUBE_CORNER_TARGETS) {
    const cornerDirection = new THREE.Vector3(
      Math.sign(cornerTarget.position[0]),
      Math.sign(cornerTarget.position[1]),
      Math.sign(cornerTarget.position[2]),
    )
    const cornerFaceGeometry = createViewCubeCornerFaceGeometry(cornerDirection, 0)
    const cornerFaceOutlineGeometry = createViewCubeCornerFaceOutlineGeometry(
      cornerDirection,
      VIEW_CUBE_SURFACE_OFFSET,
    )
    const cornerHitGeometry = createViewCubeCornerFaceGeometry(
      cornerDirection,
      VIEW_CUBE_SURFACE_OFFSET,
    )

    const cornerFace = new THREE.Mesh(cornerFaceGeometry, cornerFaceMaterial)
    cubeGroup.add(cornerFace)

    const cornerFaceOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0x8db7ff,
      transparent: true,
      opacity: 0.4,
    })
    const cornerOutline = new THREE.LineLoop(cornerFaceOutlineGeometry, cornerFaceOutlineMaterial)
    cubeGroup.add(cornerOutline)

    const hitTarget = new THREE.Mesh(cornerHitGeometry, cornerHitMaterial)
    hitTarget.userData.presetId = cornerTarget.presetId
    cubeGroup.add(hitTarget)
    interactiveObjects.push(hitTarget)

    cornerVisuals.push({
      presetId: cornerTarget.presetId,
      outlineMaterial: cornerFaceOutlineMaterial,
      faceGeometry: cornerFaceGeometry,
      outlineGeometry: cornerFaceOutlineGeometry,
      hitGeometry: cornerHitGeometry,
    })
  }

  return {
    scene,
    camera,
    interactiveObjects,
    faceVisuals,
    cornerVisuals,
    dispose: () => {
      faceFillGeometry.dispose()
      faceFillMaterial.dispose()
      faceOutlineGeometry.dispose()
      faceHitGeometry.dispose()
      faceLabelGeometry.dispose()
      faceHitMaterial.dispose()
      cornerFaceMaterial.dispose()
      cornerHitMaterial.dispose()
      faceVisuals.forEach((faceVisual) => {
        faceVisual.outlineMaterial.dispose()
        faceVisual.labelMaterial.dispose()
        faceVisual.labelTexture.dispose()
      })
      cornerVisuals.forEach((cornerVisual) => {
        cornerVisual.outlineMaterial.dispose()
        cornerVisual.faceGeometry.dispose()
        cornerVisual.outlineGeometry.dispose()
        cornerVisual.hitGeometry.dispose()
      })
    },
  }
}

export function createViewCubeFaceGeometry(halfSize: number, cornerCutSize: number) {
  const geometry = new THREE.BufferGeometry()
  const points = createViewCubeFacePoints(halfSize, cornerCutSize)

  geometry.setFromPoints(points)
  geometry.setIndex([
    0, 1, 2,
    0, 2, 3,
    0, 3, 4,
    0, 4, 5,
    0, 5, 6,
    0, 6, 7,
  ])

  return geometry
}

export function createViewCubeFaceOutlineGeometry(halfSize: number, cornerCutSize: number) {
  return new THREE.BufferGeometry().setFromPoints(createViewCubeFacePoints(halfSize, cornerCutSize))
}

export function createViewCubeFacePoints(halfSize: number, cornerCutSize: number) {
  return [
    new THREE.Vector3(-halfSize + cornerCutSize, -halfSize, 0),
    new THREE.Vector3(halfSize - cornerCutSize, -halfSize, 0),
    new THREE.Vector3(halfSize, -halfSize + cornerCutSize, 0),
    new THREE.Vector3(halfSize, halfSize - cornerCutSize, 0),
    new THREE.Vector3(halfSize - cornerCutSize, halfSize, 0),
    new THREE.Vector3(-halfSize + cornerCutSize, halfSize, 0),
    new THREE.Vector3(-halfSize, halfSize - cornerCutSize, 0),
    new THREE.Vector3(-halfSize, -halfSize + cornerCutSize, 0),
  ]
}

export function applyViewCubeRotation(
  object: THREE.Object3D,
  rotation: readonly [number, number, number],
) {
  object.rotation.set(rotation[0], rotation[1], rotation[2])
}

export function createViewCubeCornerFaceGeometry(cornerDirection: THREE.Vector3, surfaceOffset: number) {
  const geometry = new THREE.BufferGeometry()
  const points = createViewCubeCornerFacePoints(cornerDirection, surfaceOffset)

  geometry.setFromPoints(points)
  geometry.setIndex([0, 1, 2])

  return geometry
}

export function createViewCubeCornerFaceOutlineGeometry(cornerDirection: THREE.Vector3, surfaceOffset: number) {
  return new THREE.BufferGeometry().setFromPoints(
    createViewCubeCornerFacePoints(cornerDirection, surfaceOffset),
  )
}

export function createViewCubeCornerFacePoints(cornerDirection: THREE.Vector3, surfaceOffset: number) {
  const x = Math.sign(cornerDirection.x)
  const y = Math.sign(cornerDirection.y)
  const z = Math.sign(cornerDirection.z)
  const normalOffset = new THREE.Vector3(x, y, z).normalize().multiplyScalar(surfaceOffset)
  const halfSize = VIEW_CUBE_BODY_HALF_SIZE
  const cutSize = VIEW_CUBE_CORNER_CUT_SIZE

  const points = [
    new THREE.Vector3(x * (halfSize - cutSize), y * halfSize, z * halfSize).add(normalOffset),
    new THREE.Vector3(x * halfSize, y * (halfSize - cutSize), z * halfSize).add(normalOffset),
    new THREE.Vector3(x * halfSize, y * halfSize, z * (halfSize - cutSize)).add(normalOffset),
  ]

  return x * y * z > 0 ? points : [points[0]!, points[2]!, points[1]!]
}

export function createViewCubeLabelMesh(label: string, geometry: THREE.PlaneGeometry) {
  const width = 256
  const height = 128
  const devicePixelRatio = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = width * devicePixelRatio
  canvas.height = height * devicePixelRatio

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create view cube label context.')
  }

  const { outlineColor, textColor } = resolveViewCubeLabelColors()

  context.scale(devicePixelRatio, devicePixelRatio)
  context.clearRect(0, 0, width, height)
  context.font = '600 42px "Geist Sans", ui-sans-serif, system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.globalAlpha = 0.92
  context.strokeStyle = outlineColor
  context.lineWidth = 10
  context.strokeText(label, width / 2, height / 2)
  context.globalAlpha = 1
  context.fillStyle = textColor
  context.fillText(label, width / 2, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  })
  const mesh = new THREE.Mesh(geometry, material)

  return { mesh, material, texture }
}

export function resolveViewCubeLabelColors() {
  const rootStyles = getComputedStyle(document.documentElement)

  return {
    outlineColor: rootStyles.getPropertyValue('--workbench-viewport-background').trim() || 'black',
    textColor: rootStyles.getPropertyValue('--workbench-shell-text').trim() || 'white',
  }
}

export function createViewCubePlaneQuaternion(normal: THREE.Vector3, up: THREE.Vector3) {
  const normalizedNormal = normal.clone().normalize()
  const normalizedUp = up.clone().normalize()
  const right = normalizedUp.clone().cross(normalizedNormal).normalize()
  const labelUp = normalizedNormal.clone().cross(right).normalize()

  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, labelUp, normalizedNormal),
  )
}

export function updateViewCubeVisibility(
  viewCubeScene: ViewCubeSceneState,
  hoveredPresetId: ViewNavigationPresetId | null,
) {
  const cameraDirection = viewCubeScene.camera.position.clone().normalize()

  viewCubeScene.faceVisuals.forEach((faceVisual) => {
    const facingAlignment = faceVisual.normal.dot(cameraDirection)
    const facingForward = facingAlignment > 0.12
    const isHovered = faceVisual.presetId === hoveredPresetId
    let outlineOpacity = 0.16

    if (facingForward) {
      outlineOpacity = 0.58
    }

    if (isHovered) {
      outlineOpacity = 1
    }

    faceVisual.outlineMaterial.opacity = outlineOpacity
    faceVisual.labelMaterial.opacity = facingForward ? 1 : 0
  })

  viewCubeScene.cornerVisuals.forEach((cornerVisual) => {
    cornerVisual.outlineMaterial.opacity = cornerVisual.presetId === hoveredPresetId ? 1 : 0.4
  })
}

export function resolveViewCubePresetId(object: THREE.Object3D | undefined) {
  const presetId = object?.userData.presetId

  return typeof presetId === 'string' ? presetId as ViewNavigationPresetId : null
}

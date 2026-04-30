import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { getSectionPlaneOrigin, type SectionViewSession } from '@/core/section-view/session'
import {
  createSectionHatchTexture,
  getSectionPlaneBasis,
  type SectionCapRenderable,
} from '@/infrastructure/section-view/rendering'

export function SectionCapLayer({
  caps,
}: {
  caps: SectionCapRenderable[]
}) {
  const hatchTexture = useMemo(() => createSectionHatchTexture(), [])

  useEffect(() => () => hatchTexture.dispose(), [hatchTexture])

  return (
    <>
      {caps.map((cap) => (
        <SectionCapMesh key={cap.id} cap={cap} hatchTexture={hatchTexture} />
      ))}
    </>
  )
}

export function SectionCapMesh({
  cap,
  hatchTexture,
}: {
  cap: SectionCapRenderable
  hatchTexture: THREE.Texture
}) {
  const geometry = useMemo(() => {
    const nextGeometry = new THREE.BufferGeometry()
    nextGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(cap.vertexPositions.flat(), 3),
    )
    nextGeometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(cap.vertexNormals.flat(), 3),
    )
    nextGeometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(
        cap.textureCoordinates.flatMap(([u, v]) => [u / 6, v / 6]),
        2,
      ),
    )
    nextGeometry.setIndex(cap.triangleIndices.flat())
    return nextGeometry
  }, [cap])
  const fillMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: 0xd9dce1,
    metalness: 0.04,
    roughness: 0.88,
    side: THREE.DoubleSide,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }), [])
  const hatchMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    map: hatchTexture,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  }), [hatchTexture])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => fillMaterial.dispose(), [fillMaterial])
  useEffect(() => () => hatchMaterial.dispose(), [hatchMaterial])

  return (
    <group renderOrder={9}>
      <mesh geometry={geometry} material={fillMaterial} renderOrder={9} />
      <mesh geometry={geometry} material={hatchMaterial} renderOrder={10} />
    </group>
  )
}

export function SectionViewOverlay({
  bounds,
  section,
}: {
  bounds: THREE.Box3 | null
  section: SectionViewSession
}) {
  const planeOrigin = useMemo(() => getSectionPlaneOrigin(section), [section])
  const basis = useMemo(() => getSectionPlaneBasis(section.plane.frame), [section.plane.frame])
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromRotationMatrix(basis.matrix),
    [basis.matrix],
  )
  const planeSize = useMemo(() => {
    const size = bounds?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(24, 24, 24)
    return Math.max(size.length() * 0.6, 12)
  }, [bounds])
  const handleRadius = Math.max(planeSize * 0.045, 0.6)
  const outlinePoints = useMemo(() => {
    const half = planeSize / 2

    return [
      new THREE.Vector3(-half, -half, 0),
      new THREE.Vector3(half, -half, 0),
      new THREE.Vector3(half, half, 0),
      new THREE.Vector3(-half, half, 0),
    ]
  }, [planeSize])
  const outlineGeometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(outlinePoints),
    [outlinePoints],
  )
  const outlineMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: 0xbcd0e6,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  }), [])

  useEffect(() => () => outlineGeometry.dispose(), [outlineGeometry])
  useEffect(() => () => outlineMaterial.dispose(), [outlineMaterial])

  return (
    <group
      position={planeOrigin}
      quaternion={quaternion}
      renderOrder={8}
    >
      <mesh renderOrder={8}>
        <planeGeometry args={[planeSize, planeSize]} />
        <meshBasicMaterial
          color={0xa8bdd4}
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineLoop geometry={outlineGeometry} material={outlineMaterial} renderOrder={9} />
      <mesh renderOrder={10}>
        <sphereGeometry args={[handleRadius, 16, 16]} />
        <meshStandardMaterial
          color={0xe4edf6}
          emissive={0x5d8ebf}
          emissiveIntensity={0.36}
          roughness={0.3}
          metalness={0.12}
        />
      </mesh>
    </group>
  )
}

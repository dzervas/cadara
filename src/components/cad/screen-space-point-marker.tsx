import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import {
  createScreenSpacePointMarkerGeometry,
  updateScreenSpacePointMarker,
  type SketchDisplayPolylineMaterialConfig,
} from "@/components/cad/sketch-display-style";

/** Flat, camera-facing marker whose geometry is measured in CSS pixels. */
export function ScreenSpacePointMarker({
  position,
  radiusPixels,
  ring = false,
  strokeConfig,
  radiusScale = 1,
  material,
  visible = true,
  renderOrder,
}: {
  position: readonly [number, number, number];
  radiusPixels: number;
  ring?: boolean;
  strokeConfig?: SketchDisplayPolylineMaterialConfig;
  radiusScale?: number;
  material: THREE.MeshBasicMaterial;
  visible?: boolean;
  renderOrder: number;
}) {
  const { camera, size } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(
    () => createScreenSpacePointMarkerGeometry(radiusPixels, ring, strokeConfig),
    [radiusPixels, ring, strokeConfig],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    if (meshRef.current) {
      updateScreenSpacePointMarker(
        meshRef.current,
        camera,
        size.height,
        position,
        radiusScale,
      );
    }
  });
  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={position}
      visible={visible}
      renderOrder={renderOrder}
    />
  );
}

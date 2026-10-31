import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { resolveProjectPeerSelections } from "@/core/workspace/project-peer-selections";
import { createRenderMeshBufferGeometry } from "@/infrastructure/viewport/render-picking";

/** Display-only overlays: unresolved references have no matching renderable. */
export function ProjectPeerSelectionHighlights({
  highlights,
  clippingPlane,
}: {
  clippingPlane: THREE.Plane | null;
  highlights: (ReturnType<typeof resolveProjectPeerSelections>[number] & {
    color: string;
  })[];
}) {
  return (
    <group>
      {highlights.map(({ peerId, renderable, color }) => (
        <PeerHighlight
          key={`${peerId}:${renderable.id}`}
          renderable={renderable}
          color={color}
          clippingPlane={clippingPlane}
        />
      ))}
    </group>
  );
}

function PeerHighlight({
  renderable,
  color,
  clippingPlane,
}: {
  renderable: RenderableEntityRecord;
  color: string;
  clippingPlane: THREE.Plane | null;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const object = useMemo(() => {
    const data = renderable.geometry;
    let object: THREE.Mesh | THREE.Line | THREE.Points;
    if (data.kind === "mesh") {
      object = new THREE.Mesh(
        createRenderMeshBufferGeometry(data),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
    } else if (data.kind === "polyline") {
      const points = data.points.map((point) => new THREE.Vector3(...point));
      if (data.isClosed && points[0]) points.push(points[0].clone());
      object = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color, depthTest: false }),
      );
    } else {
      object = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...data.position),
        ]),
        new THREE.PointsMaterial({
          color,
          size: 8,
          sizeAttenuation: false,
          depthTest: false,
        }),
      );
    }
    (object.material as THREE.Material).clippingPlanes = clippingPlane
      ? [clippingPlane]
      : null;
    object.raycast = () => {};
    object.renderOrder = 100;
    object.userData.projectPresenceColor = color;
    return object;
  }, [renderable, color, clippingPlane]);
  useEffect(() => {
    invalidate();
    return () => {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
      invalidate();
    };
  }, [object, invalidate]);
  return <primitive object={object} />;
}

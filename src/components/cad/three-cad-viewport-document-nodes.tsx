import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { SketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import { PickBvhGroup } from "@/components/cad/three-cad-viewport-inner-components";
import {
  getDocumentRenderableMaterialOptions,
  placeFlatPointMarker,
} from "@/components/cad/sketch-display-style";
import {
  MARKER_SPHERE_GEOMETRY,
  GEOMETRY_HIGHLIGHT_COLORS,
  applyWireMaterialDepthPolicy,
  bindFaceHoverPerimeterObject,
  bindRenderableObject,
  createMeshBoundaryLineSegmentsGeometry,
  createRenderMeshBufferGeometry,
  createMarkerPickProxy,
  createRenderableLineMaterial,
  createRenderableMarkerMaterial,
  createRenderableMeshMaterial,
  getRenderableRenderOrder,
  getVisibleMarkerRadius,
  isSeededDatumPlaneRenderable,
  unbindRenderableObject,
  type RenderableMaterialDisplayOptions,
} from "@/infrastructure/viewport/render-picking";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

/**
 * The document's half of the viewport pick root. It keeps its mounted nodes
 * across snapshots: a face whose geometry survives keeps its mesh, outline
 * and BVH, and a new or re-triangulated face gets its BVH after the frame
 * (`PickBvhGroup`). Memoized: its props change with the document, not on
 * the viewport's hover and drag re-renders, so the pick group's walk over
 * the document meshes runs only when the document changes.
 */
export const DocumentPickLayer = memo(function DocumentPickLayer({
  renderables,
  palette,
  clippingPlane,
}: {
  renderables: readonly ViewportRenderableRecord[];
  palette: SketchRenderingPalette;
  clippingPlane: THREE.Plane | null;
}) {
  return (
    <PickBvhGroup>
      {renderables.map((entry) => (
        <DocumentRenderableNode
          key={`${entry.origin}:${entry.renderable.id}`}
          entry={entry}
          palette={palette}
          clippingPlane={clippingPlane}
        />
      ))}
    </PickBvhGroup>
  );
});

// Memoized: the viewport re-renders on every sketch drag move and hover,
// while a document renderable record keeps its identity until the document,
// a preview, visibility or the open sketch changes.
export const DocumentRenderableNode = memo(function DocumentRenderableNode({
  entry,
  palette,
  clippingPlane,
}: {
  entry: ViewportRenderableRecord;
  palette: SketchRenderingPalette;
  clippingPlane: THREE.Plane | null;
}) {
  switch (entry.renderable.geometry.kind) {
    case "mesh":
      return (
        <DocumentMeshNode
          entry={entry}
          palette={palette}
          clippingPlane={clippingPlane}
        />
      );
    case "polyline":
      return (
        <>
          <DocumentPolylineNode entry={entry} palette={palette} />
          {entry.sketchConstraintDisplay?.isAffectedOverconstraint ? (
            <DocumentPolylineNode entry={entry} palette={palette} diagnostic />
          ) : null}
        </>
      );
    case "marker":
      return <DocumentMarkerNode entry={entry} palette={palette} />;
  }
});

export function DocumentMeshNode({
  entry,
  palette,
  clippingPlane,
}: {
  entry: ViewportRenderableRecord;
  palette: SketchRenderingPalette;
  clippingPlane: THREE.Plane | null;
}) {
  const { renderable, origin } = entry;
  const geometryData =
    renderable.geometry.kind === "mesh" ? renderable.geometry : null;
  const geometry = useMemo(() => {
    if (!geometryData) {
      throw new Error(`Renderable ${renderable.id} is missing mesh geometry.`);
    }

    return createRenderMeshBufferGeometry(geometryData);
  }, [geometryData, renderable.id]);
  const { materialSource, materialOptions, seededDatumPlane } =
    useDocumentMaterialInputs(entry, palette);
  const material = useMemo(() => {
    const nextMaterial = seededDatumPlane
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
      : createRenderableMeshMaterial(materialSource, origin, materialOptions);

    if (clippingPlane) {
      nextMaterial.clippingPlanes = [clippingPlane];
      nextMaterial.clipShadows = true;
      nextMaterial.needsUpdate = true;
    }

    return nextMaterial;
  }, [
    clippingPlane,
    materialOptions,
    materialSource,
    origin,
    seededDatumPlane,
  ]);
  const facePerimeterGeometry = useMemo(() => {
    if (
      !geometryData ||
      (renderable.binding.semanticClass !== "bodyFace" &&
        renderable.binding.semanticClass !== "planarFace")
    ) {
      return null;
    }

    return createMeshBoundaryLineSegmentsGeometry(geometryData);
  }, [geometryData, renderable.binding.semanticClass]);
  const facePerimeterMaterial = useMemo(() => {
    if (!facePerimeterGeometry) {
      return null;
    }

    return applyWireMaterialDepthPolicy(
      new THREE.LineBasicMaterial({
        color: GEOMETRY_HIGHLIGHT_COLORS.hover,
        transparent: true,
        opacity: 0,
      }),
    );
  }, [facePerimeterGeometry]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(
    () => () => facePerimeterGeometry?.dispose(),
    [facePerimeterGeometry],
  );
  useEffect(
    () => () => facePerimeterMaterial?.dispose(),
    [facePerimeterMaterial],
  );
  const renderOrder = seededDatumPlane
    ? 1
    : getRenderableRenderOrder(renderable, origin);

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
            );
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
                renderable.binding.semanticClass as "bodyFace" | "planarFace",
                origin,
              );
            }
          }}
          geometry={facePerimeterGeometry}
          material={facePerimeterMaterial}
          renderOrder={renderOrder + 1}
        />
      ) : null}
    </group>
  );
}

export function DocumentPolylineNode({
  entry,
  palette,
  diagnostic = false,
}: {
  entry: ViewportRenderableRecord;
  palette: SketchRenderingPalette;
  diagnostic?: boolean;
}) {
  const { renderable, origin } = entry;
  if (renderable.geometry.kind !== "polyline") {
    throw new Error(
      `Renderable ${renderable.id} is missing polyline geometry.`,
    );
  }
  // Every snapshot delivers new polyline objects, also for a rename: keyed
  // on the values, an unchanged curve keeps its buffer and line object, so
  // the viewport neither swaps scene objects nor draws a frame.
  const polylineKey = JSON.stringify([
    renderable.geometry.points,
    renderable.geometry.isClosed,
  ]);
  const geometry = useMemo(() => {
    const [polylinePoints, isClosed] = JSON.parse(polylineKey) as [
      [number, number, number][],
      boolean,
    ];
    const points = polylinePoints.map(
      (point) => new THREE.Vector3(point[0], point[1], point[2]),
    );
    const displayPoints =
      isClosed && points.length > 0 ? [...points, points[0].clone()] : points;
    return new THREE.BufferGeometry().setFromPoints(displayPoints);
  }, [polylineKey]);
  const { materialSource, materialOptions, seededDatumPlane } =
    useDocumentMaterialInputs(entry, palette, diagnostic);
  const material = useMemo(
    () =>
      seededDatumPlane
        ? applyWireMaterialDepthPolicy(
            new THREE.LineBasicMaterial({
              color: 0x7f8a98,
              transparent: true,
              opacity: 0.4,
            }),
          )
        : createRenderableLineMaterial(materialSource, origin, materialOptions),
    [materialOptions, materialSource, origin, seededDatumPlane],
  );
  const renderOrder = seededDatumPlane
    ? 2
    : getRenderableRenderOrder(renderable, origin);
  const line = useMemo(() => {
    const nextLine = new THREE.Line(geometry, material);
    nextLine.renderOrder = renderOrder;
    return nextLine;
  }, [geometry, material, renderOrder]);
  // A line that survives a snapshot carries that snapshot's record, so
  // picking and hover resolve the current ids. Runs before the pick layer's
  // commit effects and before the next frame.
  useLayoutEffect(() => {
    unbindRenderableObject(line);
    bindRenderableObject(
      line,
      renderable.binding.pickId,
      renderable.binding.target,
      renderable.binding.semanticClass,
      origin,
      renderable,
    );
  }, [line, origin, renderable]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={line} />;
}

export function DocumentMarkerNode({
  entry,
  palette,
}: {
  entry: ViewportRenderableRecord;
  palette: SketchRenderingPalette;
}) {
  const { renderable, origin } = entry;
  const geometryData = renderable.geometry;
  if (geometryData.kind !== "marker") {
    throw new Error("Renderable is missing marker geometry.");
  }
  // Keyed on the values: every snapshot delivers new marker objects, and an
  // unchanged marker keeps its pick proxy (its binding is on the group).
  const pickProxyKey = JSON.stringify([
    geometryData.position,
    geometryData.displayRadius,
  ]);
  const pickProxy = useMemo(() => {
    const [position, displayRadius] = JSON.parse(pickProxyKey) as [
      [number, number, number],
      number,
    ];
    const proxy = createMarkerPickProxy(position, displayRadius);
    proxy.userData.highlightExcluded = true;
    return proxy;
  }, [pickProxyKey]);
  const { materialSource, materialOptions } = useDocumentMaterialInputs(
    entry,
    palette,
  );
  const material = useMemo(
    () =>
      createRenderableMarkerMaterial(materialSource, origin, materialOptions),
    [materialOptions, materialSource, origin],
  );

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const proxyMaterial = pickProxy.material;

    return () => {
      if (proxyMaterial instanceof THREE.Material) {
        proxyMaterial.dispose();
      }
    };
  }, [pickProxy]);
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
          );
        }
      }}
      renderOrder={getRenderableRenderOrder(renderable, origin)}
    >
      {entry.sketchPlaneFrame ? (
        <SketchPlaneMarkerDisc
          position={geometryData.position}
          radius={getVisibleMarkerRadius(geometryData.displayRadius)}
          planeNormal={entry.sketchPlaneFrame.normal}
          material={material}
          renderOrder={getRenderableRenderOrder(renderable, origin)}
        />
      ) : (
        <mesh
          geometry={MARKER_SPHERE_GEOMETRY}
          material={material}
          position={geometryData.position}
          scale={getVisibleMarkerRadius(geometryData.displayRadius)}
          renderOrder={getRenderableRenderOrder(renderable, origin)}
        />
      )}
      <primitive object={pickProxy} />
    </group>
  );
}

const SKETCH_PLANE_MARKER_DISC_GEOMETRY = new THREE.CircleGeometry(1, 32);

/**
 * A committed sketch point drawn flat, as the sphere's silhouette, but laid
 * into its sketch plane every frame (`placeFlatPointMarker`). A sphere
 * centred on a coplanar part face loses the half below the face to the
 * depth test, reading as a half disc at oblique views.
 */
function SketchPlaneMarkerDisc({
  position,
  radius,
  planeNormal,
  material,
  renderOrder,
}: {
  position: readonly [number, number, number];
  radius: number;
  planeNormal: readonly [number, number, number];
  material: THREE.Material;
  renderOrder: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (meshRef.current) {
      placeFlatPointMarker(
        meshRef.current,
        camera,
        position,
        radius,
        planeNormal,
      );
    }
  });
  return (
    <mesh
      ref={meshRef}
      geometry={SKETCH_PLANE_MARKER_DISC_GEOMETRY}
      material={material}
      position={position}
      renderOrder={renderOrder}
    />
  );
}

/**
 * Material inputs that keep their identity while their values do. Disposing a
 * material releases its shader program, so recreating every material for each
 * new snapshot recompiled every program after a rename or colour change
 * (cadara-lyi).
 */
function useDocumentMaterialInputs(
  entry: ViewportRenderableRecord,
  palette: SketchRenderingPalette,
  diagnostic = false,
) {
  const semanticClass = entry.renderable.binding.semanticClass;
  const optionsKey = JSON.stringify(
    getDocumentRenderableMaterialOptions(entry, palette, diagnostic),
  );
  const materialSource = useMemo(
    () => ({ binding: { semanticClass } }),
    [semanticClass],
  );
  const materialOptions = useMemo(
    () => JSON.parse(optionsKey) as RenderableMaterialDisplayOptions,
    [optionsKey],
  );

  return {
    materialSource,
    materialOptions,
    seededDatumPlane: isSeededDatumPlaneRenderable(entry.renderable),
  };
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bvh } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import {
  getActiveSketchMarkerWorldRadii,
  getActiveSketchPolylineStrokeGeometryConfig,
  getSketchDisplayMarkerPresentation,
  getSketchDisplayPolylineHandleVisibility,
  type SketchMarkerDisplayContext,
  buildSketchGradientMeshMaterial,
  buildSketchPolylineStrokeGeometry,
  getSketchFeedbackWorldUnitsPerPixel,
  getSketchDisplayMarkerRenderOrder,
  getSketchDisplayMarkerMaterialConfig,
  getSketchDisplayMeshMaterialConfig,
  getSketchDisplayPolylineMaterialConfig,
  shouldUseSketchStrokeMeshGeometry,
  shouldDepthTestSketchDisplayMarker,
  updateSketchGradientMaterialFrame,
} from "@/components/cad/sketch-display-style";
import type { SketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import { ScreenSpacePointMarker } from "@/components/cad/screen-space-point-marker";
import { createSketchDisplayBvhMountKey } from "@/components/cad/three-cad-viewport-helpers";
import { isProjectedSketchDisplayPointTarget } from "@/components/cad/three-cad-viewport-pick-candidates";
import { createReferenceImageDataUrl } from "@/core/reference-image/rendering";
import type { SketchSessionDisplayRenderable } from "@/core/editor/sketch-session";
import {
  applyWireMaterialDepthPolicy,
  bindRenderableObject,
  createMarkerPickProxy,
  createRenderMeshBufferGeometry,
  excludeRenderableObjectFromRaycastPicking,
  unbindRenderableObject,
} from "@/infrastructure/viewport/render-picking";

/**
 * The sketch session's half of the viewport pick root. `Bvh` indexes the
 * meshes it holds when it mounts, so it remounts when the display structure
 * changes, not when a renderable only gains or loses its pick target (the
 * region fills going stale when a drag starts): the nodes rebind their
 * mounted objects instead.
 */
export function SketchDisplayBvhLayer({
  renderables,
  applyStyles,
  palette,
  markerContext,
}: {
  renderables: readonly SketchSessionDisplayRenderable[];
  applyStyles: boolean;
  palette: SketchRenderingPalette;
  markerContext: SketchMarkerDisplayContext;
}) {
  return (
    <Bvh key={`sketch:${createSketchDisplayBvhMountKey(renderables)}`} enabled>
      {renderables.map((renderable) => (
        <SketchDisplayRenderableNode
          key={renderable.id}
          renderable={renderable}
          applyStyles={applyStyles}
          palette={palette}
          markerContext={markerContext}
        />
      ))}
    </Bvh>
  );
}

interface SketchDisplayRenderableNodeProps {
  renderable: SketchSessionDisplayRenderable;
  applyStyles: boolean;
  palette: SketchRenderingPalette;
  markerContext: SketchMarkerDisplayContext;
}

export function SketchDisplayRenderableNode({
  renderable,
  applyStyles,
  palette,
  markerContext,
}: SketchDisplayRenderableNodeProps) {
  switch (renderable.geometry.kind) {
    case "mesh":
      return (
        <SketchDisplayMeshNode
          renderable={renderable}
          applyStyles={applyStyles}
          palette={palette}
        />
      );
    case "polyline":
      return (
        <SketchDisplayPolylineNode
          renderable={renderable}
          applyStyles={applyStyles}
          palette={palette}
          markerContext={markerContext}
        />
      );
    case "marker":
      return (
        <SketchDisplayMarkerNode
          renderable={renderable}
          applyStyles={applyStyles}
          palette={palette}
          markerContext={markerContext}
        />
      );
  }
}

export function SketchDisplayMeshNode({
  renderable,
  applyStyles,
  palette,
}: {
  renderable: SketchSessionDisplayRenderable;
  applyStyles: boolean;
  palette: SketchRenderingPalette;
}) {
  const geometryData =
    renderable.geometry.kind === "mesh" ? renderable.geometry : null;
  const textureUrl = useMemo(() => {
    if (!renderable.textureFill) {
      return null;
    }

    return createReferenceImageDataUrl({
      mediaType: renderable.textureFill.mediaType,
      base64Data: renderable.textureFill.base64Data,
    });
  }, [renderable.textureFill]);
  const texture = useImageTexture(textureUrl);
  const geometry = useMemo(() => {
    if (!geometryData) {
      throw new Error("Display renderable is missing mesh geometry.");
    }

    const nextGeometry = createRenderMeshBufferGeometry(geometryData);
    if (renderable.textureFill) {
      nextGeometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          renderable.textureFill.uvCoordinates.flat(),
          2,
        ),
      );
    }
    return nextGeometry;
  }, [geometryData, renderable.textureFill]);
  const materialConfig = useMemo(
    () => getSketchDisplayMeshMaterialConfig(renderable, applyStyles, palette),
    [applyStyles, palette, renderable],
  );
  const material = useMemo(() => {
    const nextMaterial = renderable.textureFill
      ? new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: texture,
          transparent: true,
          opacity: renderable.textureFill.opacity,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      : materialConfig.fill.kind === "linearGradient"
        ? buildSketchGradientMeshMaterial(materialConfig)
        : new THREE.MeshBasicMaterial({
            color: materialConfig.color,
            transparent: materialConfig.transparent,
            opacity: materialConfig.opacity,
            side: materialConfig.side,
            polygonOffset: materialConfig.polygonOffset,
            polygonOffsetFactor: materialConfig.polygonOffsetFactor,
            polygonOffsetUnits: materialConfig.polygonOffsetUnits,
          });
    nextMaterial.depthWrite = false;
    return nextMaterial;
  }, [materialConfig, renderable.textureFill, texture]);

  useLayoutEffect(() => {
    updateSketchGradientMaterialFrame(material, geometry, materialConfig);
  }, [geometry, material, materialConfig]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      ref={(value) => {
        if (!value) {
          return;
        }
        unbindRenderableObject(value);
        if (renderable.target) {
          bindRenderableObject(
            value,
            null,
            renderable.target,
            renderable.semanticClass ??
              (renderable.role === "reference"
                ? "sketchReference"
                : "sketchCurve"),
            "document",
          );
        }
      }}
      geometry={geometry}
      material={material}
      renderOrder={renderable.textureFill ? 1 : 0}
    />
  );
}

function useImageTexture(url: string | null) {
  const [texture, setTexture] = useState<{
    url: string;
    texture: THREE.Texture;
  } | null>(null);

  useEffect(() => {
    if (!url) {
      return;
    }

    let cancelled = false;
    let loadedTexture: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (loaded) => {
        if (cancelled) {
          loaded.dispose();
          return;
        }

        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.needsUpdate = true;
        loadedTexture = loaded;
        setTexture((current) => {
          current?.texture.dispose();
          return { url, texture: loaded };
        });
      },
      undefined,
      (error) => {
        if (cancelled) {
          return;
        }

        console.error("Failed to load reference-image texture.", error);
      },
    );

    return () => {
      cancelled = true;
      loadedTexture?.dispose();
    };
  }, [url]);

  return texture?.url === url ? texture.texture : null;
}

function updatePolylineGeometryBuffer(
  geometry: THREE.BufferGeometry,
  geometryData: Extract<
    SketchSessionDisplayRenderable["geometry"],
    { kind: "polyline" }
  >,
) {
  const points =
    geometryData.isClosed && geometryData.points.length > 0
      ? [...geometryData.points, geometryData.points[0]!]
      : geometryData.points;
  let position = geometry.getAttribute("position") as
    | THREE.BufferAttribute
    | undefined;

  if (!position || position.count !== points.length) {
    position = new THREE.BufferAttribute(
      new Float32Array(points.length * 3),
      3,
    );
    geometry.setAttribute("position", position);
  }

  points.forEach((point, index) => {
    position.setXYZ(index, point[0], point[1], point[2]);
  });
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

export function SketchDisplayPolylineNode({
  renderable,
  applyStyles,
  palette,
  markerContext,
}: {
  renderable: SketchSessionDisplayRenderable;
  applyStyles: boolean;
  palette: SketchRenderingPalette;
  markerContext?: SketchMarkerDisplayContext;
}) {
  const geometryData =
    renderable.geometry.kind === "polyline" ? renderable.geometry : null;
  if (!geometryData) {
    throw new Error(
      `Display renderable ${renderable.id} is missing polyline geometry.`,
    );
  }

  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const materialConfig = useMemo(
    () =>
      getSketchDisplayPolylineMaterialConfig(renderable, applyStyles, palette),
    [applyStyles, palette, renderable],
  );
  const useStrokeMesh = shouldUseSketchStrokeMeshGeometry(
    renderable,
    materialConfig,
    applyStyles,
  );
  const strokeGeometryMaterialConfig = useMemo(
    () =>
      getActiveSketchPolylineStrokeGeometryConfig(
        renderable,
        materialConfig,
        applyStyles,
      ),
    [applyStyles, materialConfig, renderable],
  );
  const strokeGeometryStaticToken = useMemo(
    () =>
      createStrokeGeometryStaticToken(
        geometryData,
        strokeGeometryMaterialConfig,
      ),
    [geometryData, strokeGeometryMaterialConfig],
  );
  const { color, dashSize, gapSize, linePattern, lineWidth, opacity } =
    materialConfig;
  const { camera, size } = useThree();
  const strokeGeometryTokenRef = useRef<string | null>(null);
  const strokeGeometryFrameRef = useRef<
    SketchSessionDisplayRenderable["sketchPlaneFrame"] | null
  >(null);
  const material = useMemo(() => {
    if (useStrokeMesh) {
      const nextMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
      });
      nextMaterial.depthWrite = false;
      return nextMaterial;
    }

    return applyWireMaterialDepthPolicy(
      linePattern === "dashed"
        ? new THREE.LineDashedMaterial({
            color,
            transparent: true,
            opacity,
            linewidth: lineWidth,
            dashSize,
            gapSize,
          })
        : new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity,
            linewidth: lineWidth,
          }),
    );
  }, [
    color,
    dashSize,
    gapSize,
    linePattern,
    lineWidth,
    opacity,
    useStrokeMesh,
  ]);
  const line = useMemo(() => {
    const nextLine = useStrokeMesh
      ? new THREE.Mesh(geometry, material)
      : new THREE.Line(geometry, material);
    nextLine.renderOrder = 3;

    if (renderable.target) {
      bindRenderableObject(
        nextLine,
        null,
        renderable.target,
        renderable.role === "reference" ? "sketchReference" : "sketchCurve",
        "document",
      );
      excludeRenderableObjectFromRaycastPicking(nextLine);
    }

    return nextLine;
  }, [geometry, material, renderable.role, renderable.target, useStrokeMesh]);

  useLayoutEffect(() => {
    if (useStrokeMesh) {
      const worldUnitsPerPixel = getSketchFeedbackWorldUnitsPerPixel(
        camera,
        size.height,
        geometryData.points,
      );
      const token = createStrokeGeometryToken(
        strokeGeometryStaticToken,
        worldUnitsPerPixel,
      );
      // Every session update (each drag move) brings new geometry objects
      // for every curve; a curve whose stroke inputs are unchanged keeps
      // its buffer.
      if (
        token === strokeGeometryTokenRef.current &&
        renderable.sketchPlaneFrame === strokeGeometryFrameRef.current
      ) {
        return;
      }
      updatePolylineStrokeGeometryBuffer(
        geometry,
        geometryData,
        strokeGeometryMaterialConfig,
        worldUnitsPerPixel,
        renderable.sketchPlaneFrame,
      );
      strokeGeometryTokenRef.current = token;
      strokeGeometryFrameRef.current = renderable.sketchPlaneFrame;
      return;
    }

    strokeGeometryTokenRef.current = null;
    strokeGeometryFrameRef.current = null;
    updatePolylineGeometryBuffer(geometry, geometryData);

    if (linePattern === "dashed" && line instanceof THREE.Line) {
      line.computeLineDistances();
    }
  }, [
    camera,
    geometry,
    geometryData,
    line,
    linePattern,
    renderable.sketchPlaneFrame,
    size.height,
    strokeGeometryMaterialConfig,
    strokeGeometryStaticToken,
    useStrokeMesh,
  ]);

  useFrame(({ camera: frameCamera, size: frameSize }) => {
    if (!useStrokeMesh) {
      return;
    }

    const worldUnitsPerPixel = getSketchFeedbackWorldUnitsPerPixel(
      frameCamera,
      frameSize.height,
      geometryData.points,
    );
    const token = createStrokeGeometryToken(
      strokeGeometryStaticToken,
      worldUnitsPerPixel,
    );
    if (token === strokeGeometryTokenRef.current) {
      return;
    }

    updatePolylineStrokeGeometryBuffer(
      geometry,
      geometryData,
      strokeGeometryMaterialConfig,
      worldUnitsPerPixel,
      renderable.sketchPlaneFrame,
    );
    strokeGeometryTokenRef.current = token;
    strokeGeometryFrameRef.current = renderable.sketchPlaneFrame;
  });

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  const handleVisible = markerContext
    ? getSketchDisplayPolylineHandleVisibility(renderable, markerContext)
    : true;

  return <primitive object={line} visible={handleVisible} />;
}

function updatePolylineStrokeGeometryBuffer(
  geometry: THREE.BufferGeometry,
  geometryData: Extract<
    SketchSessionDisplayRenderable["geometry"],
    { kind: "polyline" }
  >,
  materialConfig: ReturnType<typeof getSketchDisplayPolylineMaterialConfig>,
  worldUnitsPerPixel: number,
  sketchPlaneFrame: SketchSessionDisplayRenderable["sketchPlaneFrame"],
) {
  const nextGeometry = buildSketchPolylineStrokeGeometry({
    points: geometryData.points,
    isClosed: geometryData.isClosed,
    materialConfig,
    worldUnitsPerPixel,
    sketchPlaneFrame,
  });
  geometry.dispose();
  geometry.copy(nextGeometry);
  nextGeometry.dispose();
  geometry.computeBoundingSphere();
}

function createStrokeGeometryStaticToken(
  geometryData: Extract<
    SketchSessionDisplayRenderable["geometry"],
    { kind: "polyline" }
  >,
  materialConfig: ReturnType<typeof getSketchDisplayPolylineMaterialConfig>,
) {
  return JSON.stringify({
    points: geometryData.points,
    isClosed: geometryData.isClosed,
    width: materialConfig.lineWidth,
    cap: materialConfig.lineCap,
    join: materialConfig.lineJoin,
    miterLimit: materialConfig.miterLimit,
    pattern: materialConfig.linePattern,
    dashSize: materialConfig.dashSize,
    gapSize: materialConfig.gapSize,
    dotSize: materialConfig.dotSize,
  });
}

function createStrokeGeometryToken(
  staticToken: string,
  worldUnitsPerPixel: number,
) {
  return `${staticToken}:${getStrokeScaleToken(worldUnitsPerPixel)}`;
}

function getStrokeScaleToken(worldUnitsPerPixel: number) {
  if (!Number.isFinite(worldUnitsPerPixel) || worldUnitsPerPixel <= 0) {
    return "1";
  }

  return String(Math.round(Math.log2(worldUnitsPerPixel) * 48));
}

export function SketchDisplayMarkerNode({
  renderable,
  applyStyles,
  palette,
  markerContext,
}: {
  renderable: SketchSessionDisplayRenderable;
  applyStyles: boolean;
  palette: SketchRenderingPalette;
  markerContext: SketchMarkerDisplayContext;
}) {
  const geometryData =
    renderable.geometry.kind === "marker" ? renderable.geometry : null;
  if (!geometryData) {
    throw new Error("Display renderable is missing marker geometry.");
  }
  const { visible, radiusScale } = getSketchDisplayMarkerPresentation(
    renderable,
    markerContext,
  );

  const strokeConfig = useMemo(
    () =>
      renderable.markerShape === "ring"
        ? getSketchDisplayPolylineMaterialConfig(renderable, applyStyles, palette)
        : undefined,
    [applyStyles, palette, renderable],
  );
  const materialConfig = useMemo(
    () =>
      getSketchDisplayMarkerMaterialConfig(renderable, applyStyles, palette),
    [applyStyles, palette, renderable],
  );
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        ...materialConfig,
        depthTest: shouldDepthTestSketchDisplayMarker(renderable),
        depthWrite: false,
      }),
    [materialConfig, renderable],
  );
  const { camera, size } = useThree();
  const pickProxy = useMemo(() => {
    const proxy = createMarkerPickProxy([0, 0, 0], geometryData.displayRadius);
    proxy.userData.highlightExcluded = true;
    return proxy;
  }, [geometryData.displayRadius]);
  const radii = getActiveSketchMarkerWorldRadii(
    renderable,
    camera,
    size.height,
  );

  useLayoutEffect(() => {
    pickProxy.position.set(
      geometryData.position[0],
      geometryData.position[1],
      geometryData.position[2],
    );
    updateActiveSketchMarkerPickScale(
      pickProxy,
      renderable,
      camera,
      size.height,
    );
  }, [
    camera,
    geometryData.position,
    pickProxy,
    renderable,
    size.height,
  ]);

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const mesh = pickProxy;
    return () => {
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    };
  }, [pickProxy]);
  return (
    <group
      ref={(value) => {
        if (!value) {
          return;
        }
        unbindRenderableObject(value);
        if (renderable.target) {
          bindRenderableObject(
            value,
            null,
            renderable.target,
            renderable.role === "reference" ? "sketchReference" : "sketchPoint",
            "document",
          );
          // Picked in screen space only: one canonical candidate (T11c, A-1).
          if (isProjectedSketchDisplayPointTarget(renderable.target)) {
            excludeRenderableObjectFromRaycastPicking(value);
          }
        }
      }}
    >
      <ScreenSpacePointMarker
        visible={visible}
        material={material}
        position={geometryData.position}
        radiusPixels={radii.visiblePixelRadius}
        radiusScale={radiusScale}
        ring={renderable.markerShape === "ring"}
        strokeConfig={strokeConfig}
        renderOrder={getSketchDisplayMarkerRenderOrder(renderable)}
      />
      <primitive object={pickProxy} />
    </group>
  );
}

function updateActiveSketchMarkerPickScale(
  pickProxy: THREE.Mesh,
  renderable: SketchSessionDisplayRenderable,
  camera: THREE.Camera,
  viewportHeight: number,
) {
  const radii = getActiveSketchMarkerWorldRadii(
    renderable,
    camera,
    viewportHeight,
  );
  pickProxy.scale.setScalar(radii.pickRadius);
}

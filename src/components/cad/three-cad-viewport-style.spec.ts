import { test, expect } from "vitest";
import * as THREE from "three";

import {
  ACTIVE_SKETCH_FEEDBACK_PIXEL_BOUNDS,
  buildSketchGradientMeshMaterial,
  buildSketchPolylineStrokeGeometry,
  getActiveSketchMarkerWorldRadii,
  getActiveSketchPolylineStrokeGeometryConfig,
  getSketchDisplayMarkerRenderOrder,
  getSketchDisplayMeshMaterialConfig,
  getSketchDisplayMarkerMaterialConfig,
  getSketchDisplayPolylineMaterialConfig,
  getSketchFeedbackWorldUnitsPerPixel,
  shouldUseSketchStrokeMeshGeometry,
  splitSketchPolylineDashSegments,
  shouldDepthTestSketchDisplayMarker,
  shouldApplySketchDisplayStyles,
} from "@/components/cad/sketch-display-style";
import {
  SKETCH_RENDERING_PALETTE_TOKENS,
  getSketchRenderingPaletteToken,
  resolveSketchRenderingPalette,
} from "@/components/cad/sketch-rendering-palette";

test("src/components/cad/three-cad-viewport-style.spec.ts", () => {
  const palette = {
    constrained: 0x222222,
    underconstrained: 0x1651b0,
    overconstrained: 0xff5555,
    regionFill: 0x343a40,
  } as const;

  const styledPolylineRenderable = {
    id: "renderable_sketch_line_1",
    label: "Styled line",
    geometry: {
      kind: "polyline",
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      isClosed: false,
    },
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_1",
    },
    linePattern: "solid",
    role: "local",
    strokeStyle: {
      color: 0x33ffaa,
      opacity: 0.5,
      width: 3,
      lineCap: "square",
      lineJoin: "miter",
      miterLimit: 7,
      dashSize: 0.5,
      gapSize: 0.2,
    },
  } as const;

  const styledMeshRenderable = {
    id: "renderable_sketch_mesh_1",
    label: "Styled region",
    geometry: {
      kind: "mesh",
      vertexPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      vertexNormals: null,
      triangleIndices: [[0, 1, 2]],
    },
    target: null,
    linePattern: "solid",
    role: "local",
    paintStyle: {
      kind: "solid",
      color: 0xaa33ff,
      opacity: 0.44,
    },
  } as const;
  const gradientMeshRenderable = {
    ...styledMeshRenderable,
    paintStyle: {
      kind: "linearGradient",
      startColor: 0x2266ff,
      startOpacity: 0.2,
      endColor: 0xffaa33,
      endOpacity: 0.72,
      angleRadians: Math.PI / 4,
      fallbackColor: 0x2266ff,
      fallbackOpacity: 0.2,
    },
  } as const;

  expect(
    shouldApplySketchDisplayStyles("sketch", true),
    "Sketch display styling should be enabled while an active sketch session is being edited.",
  ).toBeTruthy();
  expect(
    shouldApplySketchDisplayStyles("part", true),
    "Sketch display styling should be disabled in part mode, even if a sketch session object exists.",
  ).toBeFalsy();

  const styledLineConfig = getSketchDisplayPolylineMaterialConfig(
    styledPolylineRenderable,
    true,
    palette,
  );
  expect(
    styledLineConfig.color,
    "Sketch mode should apply stroke color from renderable style metadata.",
  ).toBe(0x33ffaa);
  expect(
    styledLineConfig.opacity,
    "Sketch mode should apply stroke opacity from renderable style metadata.",
  ).toBe(0.5);
  expect(
    styledLineConfig.lineWidth,
    "Sketch mode should apply stroke width from renderable style metadata.",
  ).toBe(3);
  expect(
    styledLineConfig.linePattern,
    "Sketch mode should use dashed materials for authored dash patterns.",
  ).toBe("dashed");
  expect(
    styledLineConfig.dashSize,
    "Sketch mode should apply authored dash size.",
  ).toBe(0.5);
  expect(
    styledLineConfig.gapSize,
    "Sketch mode should apply authored gap size.",
  ).toBe(0.2);
  expect(
    styledLineConfig.lineJoin,
    "Sketch mode should preserve authored line join in material config.",
  ).toBe("miter");
  expect(
    styledLineConfig.miterLimit,
    "Sketch mode should preserve authored miter limit in material config.",
  ).toBe(7);
  expect(
    shouldUseSketchStrokeMeshGeometry(
      styledPolylineRenderable,
      styledLineConfig,
      true,
    ),
    "Authored SVG stroke style should use mesh stroke geometry instead of native Three line primitives.",
  ).toBeTruthy();

  const partModeLineConfig = getSketchDisplayPolylineMaterialConfig(
    styledPolylineRenderable,
    false,
    palette,
  );
  expect(
    partModeLineConfig.color,
    "Part mode should fall back to neutral CAD stroke colors instead of sketch-authored style metadata.",
  ).not.toBe(0x33ffaa);
  expect(
    partModeLineConfig.opacity,
    "Part mode should use the existing neutral solid-line opacity.",
  ).toBe(0.95);
  expect(
    partModeLineConfig.lineWidth,
    "Part mode should preserve default line-width behavior for picking stability.",
  ).toBe(1);

  const styledMeshConfig = getSketchDisplayMeshMaterialConfig(
    styledMeshRenderable,
    true,
    palette,
  );
  expect(
    styledMeshConfig.color,
    "Sketch mode should apply paint color from renderable style metadata.",
  ).toBe(0xaa33ff);
  expect(
    styledMeshConfig.opacity,
    "Sketch mode should apply paint opacity from renderable style metadata.",
  ).toBe(0.44);
  expect(
    styledMeshConfig.fill.kind,
    "Solid sketch fills should remain explicit material input.",
  ).toBe("solid");

  const gradientMeshConfig = getSketchDisplayMeshMaterialConfig(
    gradientMeshRenderable,
    true,
    palette,
  );
  expect(
    gradientMeshConfig.fill.kind,
    "Sketch mode should preserve linear-gradient fill material input instead of collapsing it to a solid color.",
  ).toBe("linearGradient");
  expect(
    gradientMeshConfig.fill.startColor === 0x2266ff &&
      gradientMeshConfig.fill.startOpacity === 0.2 &&
      gradientMeshConfig.fill.endColor === 0xffaa33 &&
      gradientMeshConfig.fill.endOpacity === 0.72 &&
      gradientMeshConfig.fill.angleRadians === Math.PI / 4,
    "Gradient material input should preserve start/end color, opacity, and angle.",
  ).toBeTruthy();
  const gradientMaterial = buildSketchGradientMeshMaterial(gradientMeshConfig);
  expect(
    gradientMaterial instanceof THREE.ShaderMaterial &&
      gradientMaterial.uniforms.startColor.value instanceof THREE.Color &&
      gradientMaterial.uniforms.endColor.value instanceof THREE.Color,
    "Gradient region fills should build a gradient-capable shader material.",
  ).toBeTruthy();
  gradientMaterial.dispose();

  const partModeMeshConfig = getSketchDisplayMeshMaterialConfig(
    styledMeshRenderable,
    false,
    palette,
  );
  expect(
    partModeMeshConfig.color,
    "Part mode should not apply sketch paint styles to display mesh renderables.",
  ).not.toBe(0xaa33ff);
  const disabledGradientMeshConfig = getSketchDisplayMeshMaterialConfig(
    gradientMeshRenderable,
    false,
    palette,
  );
  expect(
    disabledGradientMeshConfig.fill.kind === "solid" &&
      gradientMeshRenderable.paintStyle.kind === "linearGradient",
    "Disabling SVG rendering should suppress visual gradient effects without deleting authored gradient style data.",
  ).toBeTruthy();

  const regionMeshConfig = getSketchDisplayMeshMaterialConfig(
    {
      ...styledMeshRenderable,
      semanticClass: "region",
    },
    false,
    palette,
  );
  expect(
    regionMeshConfig.polygonOffset,
    "Sketch-owned region fills should use polygon offset.",
  ).toBeTruthy();
  expect(
    regionMeshConfig.polygonOffsetFactor < 0 &&
      regionMeshConfig.polygonOffsetUnits < 0,
    "Sketch-owned region fills should be biased toward the camera to avoid coplanar flicker.",
  ).toBeTruthy();

  expect(
    getSketchRenderingPaletteToken("constrained") ===
      "--workbench-tooltip-description" &&
      getSketchRenderingPaletteToken("underconstrained") ===
        "--mantine-color-blue-9" &&
      getSketchRenderingPaletteToken("overconstrained") ===
        "--workbench-shell-danger-text" &&
      getSketchRenderingPaletteToken("regionFill") ===
        "--workbench-shell-border",
    "Sketch palette roles should map to exact existing theme tokens.",
  ).toBeTruthy();
  expect(
    Object.values(SKETCH_RENDERING_PALETTE_TOKENS).every((token) =>
      [
        "--workbench-tooltip-description",
        "--mantine-color-blue-9",
        "--workbench-shell-danger-text",
        "--workbench-shell-border",
      ].includes(token),
    ),
    "Sketch palette resolver should not introduce non-theme color tokens.",
  ).toBeTruthy();

  const resolvedPalette = resolveSketchRenderingPalette((token) => {
    const values: Record<string, string> = {
      "--workbench-tooltip-description": "rgb(34, 34, 34)",
      "--mantine-color-blue-9": "rgb(22, 81, 176)",
      "--workbench-shell-danger-text": "rgb(255, 85, 85)",
      "--workbench-shell-border": "rgb(52, 58, 64)",
    };
    return values[token] ?? "";
  });
  expect(
    resolvedPalette.underconstrained,
    "Palette resolver should convert theme CSS values for Three materials.",
  ).toBe(0x1651b0);

  const constrainedLineConfig = getSketchDisplayPolylineMaterialConfig(
    {
      ...styledPolylineRenderable,
      strokeStyle: undefined,
      constraintDisplay: {
        state: "constrained",
        isAffectedOverconstraint: false,
      },
    },
    true,
    palette,
  );
  expect(
    constrainedLineConfig.color,
    "Fully constrained sketch lines should default to the constrained theme color.",
  ).toBe(palette.constrained);

  const diagnosticLineConfig = getSketchDisplayPolylineMaterialConfig(
    {
      ...styledPolylineRenderable,
      diagnosticStyle: { kind: "overconstraint" },
      constraintDisplay: {
        state: "overconstrained",
        isAffectedOverconstraint: true,
      },
    },
    true,
    palette,
  );
  expect(
    diagnosticLineConfig.color,
    "Affected overconstrained edge diagnostics should use the error color.",
  ).toBe(palette.overconstrained);
  expect(
    diagnosticLineConfig.lineWidth,
    "Affected overconstrained edge diagnostics should stay thin.",
  ).toBe(1);
  expect(
    diagnosticLineConfig.color,
    "Diagnostic edge overlays may override authored stroke color without replacing the base authored stroke.",
  ).not.toBe(styledPolylineRenderable.strokeStyle.color);

  const affectedMarkerConfig = getSketchDisplayMarkerMaterialConfig(
    {
      ...styledPolylineRenderable,
      geometry: { kind: "marker", position: [0, 0, 0], displayRadius: 0.1 },
      strokeStyle: undefined,
      constraintDisplay: {
        state: "overconstrained",
        isAffectedOverconstraint: true,
      },
    },
    true,
    palette,
  );
  expect(
    affectedMarkerConfig.color,
    "Affected overconstrained sketch vertices should use the error color family.",
  ).toBe(palette.overconstrained);

  const overlayMarkerRenderable = {
    ...styledPolylineRenderable,
    geometry: { kind: "marker", position: [0, 0, 0], displayRadius: 0.4 },
    markerLayer: "overlay" as const,
  };
  expect(
    shouldDepthTestSketchDisplayMarker(overlayMarkerRenderable),
    "Overlay sketch markers should ignore depth so image-bound anchors remain visible above reference-image quads.",
  ).toBeFalsy();
  expect(
    getSketchDisplayMarkerRenderOrder(overlayMarkerRenderable) >
      getSketchDisplayMarkerRenderOrder({
        ...overlayMarkerRenderable,
        markerLayer: "default" as const,
      }),
    "Overlay sketch markers should render after default sketch points.",
  ).toBeTruthy();
});

test("src/components/cad/three-cad-viewport-style.spec.ts active sketch feedback world units per pixel", () => {
  const orthographic = new THREE.OrthographicCamera(
    -10,
    10,
    10,
    -10,
    0.1,
    1000,
  );
  orthographic.zoom = 1;
  orthographic.updateProjectionMatrix();
  expect(
    nearlyEqual(
      getSketchFeedbackWorldUnitsPerPixel(orthographic, 1000, [[0, 0, 0]]),
      0.02,
    ),
    "Orthographic active sketch feedback scale should derive from camera span and viewport height.",
  ).toBeTruthy();

  orthographic.zoom = 4;
  orthographic.updateProjectionMatrix();
  expect(
    nearlyEqual(
      getSketchFeedbackWorldUnitsPerPixel(orthographic, 1000, [[0, 0, 0]]),
      0.005,
    ),
    "Orthographic active sketch feedback scale should shrink as zoom increases.",
  ).toBeTruthy();

  const perspective = new THREE.PerspectiveCamera(90, 1, 0.1, 1000);
  perspective.position.set(0, 0, 10);
  perspective.updateMatrixWorld();
  const nearScale = getSketchFeedbackWorldUnitsPerPixel(perspective, 1000, [
    [0, 0, 0],
  ]);
  perspective.position.set(0, 0, 100);
  perspective.updateMatrixWorld();
  const farScale = getSketchFeedbackWorldUnitsPerPixel(perspective, 1000, [
    [0, 0, 0],
  ]);

  expect(
    nearlyEqual(nearScale, 0.02),
    "Perspective active sketch feedback scale should use camera distance to the anchor.",
  ).toBeTruthy();
  expect(
    nearlyEqual(farScale, 0.2),
    "Perspective active sketch feedback scale should grow as the camera moves away.",
  ).toBeTruthy();
});

test("src/components/cad/three-cad-viewport-style.spec.ts active sketch marker screen-space radii", () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  const renderable = {
    id: "renderable_sketch_marker_1",
    label: "Point",
    geometry: { kind: "marker", position: [0, 0, 0], displayRadius: 0.18 },
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_primary",
      pointId: "point_1",
    },
    linePattern: "solid",
    role: "local",
  } as const;

  const zoomedOut = getActiveSketchMarkerWorldRadii(renderable, camera, 1000);
  camera.zoom = 5;
  camera.updateProjectionMatrix();
  const zoomedIn = getActiveSketchMarkerWorldRadii(renderable, camera, 1000);

  expect(
    zoomedOut.visiblePixelRadius,
    "Active sketch marker visible pixel radius should stay stable after camera zoom changes.",
  ).toBe(zoomedIn.visiblePixelRadius);
  expect(
    zoomedOut.pickPixelRadius,
    "Active sketch marker pick proxy pixel radius should stay stable after camera zoom changes.",
  ).toBe(zoomedIn.pickPixelRadius);
  expect(
    zoomedOut.pickPixelRadius >= zoomedOut.visiblePixelRadius &&
      zoomedOut.pickPixelRadius >=
        ACTIVE_SKETCH_FEEDBACK_PIXEL_BOUNDS.marker.pickProxy.min,
    "Active sketch marker pick proxy should remain at least as reachable as the visible marker.",
  ).toBeTruthy();
  expect(
    zoomedIn.visibleRadius < zoomedOut.visibleRadius &&
      zoomedIn.pickRadius < zoomedOut.pickRadius,
    "Active sketch marker world radii should change with camera scale to preserve screen-space size.",
  ).toBeTruthy();
  expect(
    zoomedOut.visiblePixelRadius <= 5.1,
    "Default active sketch vertices should stay compact while remaining screen-space stabilized.",
  ).toBeTruthy();

  const overlay = getActiveSketchMarkerWorldRadii(
    {
      ...renderable,
      geometry: { ...renderable.geometry, displayRadius: 0.4 },
      markerLayer: "overlay",
    },
    camera,
    1000,
  );
  expect(
    overlay.visiblePixelRadius,
    "Overlay active sketch markers should clamp to the overlay marker pixel bounds.",
  ).toBe(ACTIVE_SKETCH_FEEDBACK_PIXEL_BOUNDS.marker.overlay.max);
});

test("src/components/cad/three-cad-viewport-style.spec.ts active sketch stroke geometry screen-space sizing", () => {
  const palette = {
    constrained: 0x222222,
    underconstrained: 0x1651b0,
    overconstrained: 0xff5555,
    regionFill: 0x343a40,
  } as const;
  const renderable = {
    id: "renderable_sketch_default_line_1",
    label: "Default line",
    geometry: {
      kind: "polyline",
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      isClosed: false,
    },
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_1",
    },
    linePattern: "solid",
    role: "local",
  } as const;
  const materialConfig = getSketchDisplayPolylineMaterialConfig(
    renderable,
    true,
    palette,
  );
  const geometryConfig = getActiveSketchPolylineStrokeGeometryConfig(
    renderable,
    materialConfig,
    true,
  );
  const wideWorld = buildSketchPolylineStrokeGeometry({
    points: renderable.geometry.points,
    isClosed: false,
    materialConfig: geometryConfig,
    worldUnitsPerPixel: 0.2,
  });
  const narrowWorld = buildSketchPolylineStrokeGeometry({
    points: renderable.geometry.points,
    isClosed: false,
    materialConfig: geometryConfig,
    worldUnitsPerPixel: 0.02,
  });
  const wideBounds = getGeometryBounds(wideWorld);
  const narrowBounds = getGeometryBounds(narrowWorld);

  expect(
    shouldUseSketchStrokeMeshGeometry(renderable, materialConfig, true),
    "Default active sketch wires should use mesh stroke geometry instead of native line width.",
  ).toBeTruthy();
  expect(
    geometryConfig.lineWidth,
    "Default active sketch wires should use the default wire pixel-size bounds.",
  ).toBe(ACTIVE_SKETCH_FEEDBACK_PIXEL_BOUNDS.stroke.default.min);
  expect(
    materialConfig.color === geometryConfig.color &&
      materialConfig.opacity === geometryConfig.opacity &&
      materialConfig.lineCap === geometryConfig.lineCap &&
      materialConfig.lineJoin === geometryConfig.lineJoin &&
      materialConfig.linePattern === geometryConfig.linePattern,
    "Active sketch stroke sizing should preserve existing wire color, opacity, cap, join, and pattern styling.",
  ).toBeTruthy();
  expect(
    getStrokeWorldHeight(wideBounds) > getStrokeWorldHeight(narrowBounds),
    "Active sketch stroke geometry world thickness should change as the camera-derived pixel scale changes.",
  ).toBeTruthy();

  wideWorld.dispose();
  narrowWorld.dispose();
});

test("src/components/cad/three-cad-viewport-style.spec.ts SVG stroke mesh geometry", () => {
  const baseConfig = {
    linePattern: "solid" as const,
    color: 0xffffff,
    opacity: 1,
    lineWidth: 2,
    lineCap: "butt" as const,
    lineJoin: "miter" as const,
    miterLimit: 4,
    dashSize: 0,
    gapSize: 0,
  };
  const linePoints = [
    [0, 0, 0],
    [10, 0, 0],
  ] as const;

  const butt = buildSketchPolylineStrokeGeometry({
    points: linePoints,
    isClosed: false,
    materialConfig: baseConfig,
    worldUnitsPerPixel: 1,
  });
  const square = buildSketchPolylineStrokeGeometry({
    points: linePoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineCap: "square" },
    worldUnitsPerPixel: 1,
  });
  const round = buildSketchPolylineStrokeGeometry({
    points: linePoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineCap: "round" },
    worldUnitsPerPixel: 1,
  });
  const buttBounds = getGeometryBounds(butt);
  const squareBounds = getGeometryBounds(square);
  const roundBounds = getGeometryBounds(round);

  expect(
    nearlyEqual(buttBounds.min.x, 0) && nearlyEqual(buttBounds.max.x, 10),
    "Butt caps should not extend stroke mesh bounds past open line endpoints.",
  ).toBeTruthy();
  expect(
    nearlyEqual(squareBounds.min.x, -1) && nearlyEqual(squareBounds.max.x, 11),
    "Square caps should extend by half the stroke width past open line endpoints.",
  ).toBeTruthy();
  expect(
    roundBounds.min.x < 0 &&
      roundBounds.max.x > 10 &&
      getPositionCount(round) > getPositionCount(butt),
    "Round caps should add cap geometry beyond open line endpoints.",
  ).toBeTruthy();

  const closedButt = buildSketchPolylineStrokeGeometry({
    points: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ],
    isClosed: true,
    materialConfig: baseConfig,
    worldUnitsPerPixel: 1,
  });
  const closedSquare = buildSketchPolylineStrokeGeometry({
    points: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ],
    isClosed: true,
    materialConfig: { ...baseConfig, lineCap: "square" },
    worldUnitsPerPixel: 1,
  });
  expect(
    getPositionCount(closedButt) === getPositionCount(closedSquare) &&
      getGeometryBounds(closedButt).min.distanceTo(
        getGeometryBounds(closedSquare).min,
      ) < 1e-6 &&
      getGeometryBounds(closedButt).max.distanceTo(
        getGeometryBounds(closedSquare).max,
      ) < 1e-6,
    "Closed polylines should ignore endcap style and use join geometry.",
  ).toBeTruthy();

  const cornerPoints = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
  ] as const;
  const bevel = buildSketchPolylineStrokeGeometry({
    points: cornerPoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineJoin: "bevel" },
    worldUnitsPerPixel: 1,
  });
  const miter = buildSketchPolylineStrokeGeometry({
    points: cornerPoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineJoin: "miter", miterLimit: 8 },
    worldUnitsPerPixel: 1,
  });
  const roundJoin = buildSketchPolylineStrokeGeometry({
    points: cornerPoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineJoin: "round" },
    worldUnitsPerPixel: 1,
  });
  const clippedMiter = buildSketchPolylineStrokeGeometry({
    points: cornerPoints,
    isClosed: false,
    materialConfig: { ...baseConfig, lineJoin: "miter", miterLimit: 0.1 },
    worldUnitsPerPixel: 1,
  });

  expect(
    getPositionCount(roundJoin) > getPositionCount(bevel),
    "Round joins should create more corner geometry than bevel joins.",
  ).toBeTruthy();
  expect(
    getPositionCount(miter),
    "Miter joins should produce distinct corner geometry from bevel joins.",
  ).not.toBe(getPositionCount(bevel));
  expect(
    getPositionCount(clippedMiter),
    "Miter limit should safely fall back instead of emitting the full miter corner.",
  ).not.toBe(getPositionCount(miter));

  const dashedSegments = splitSketchPolylineDashSegments(
    [new THREE.Vector2(0, 0), new THREE.Vector2(10, 0)],
    2,
    2,
    false,
  );
  expect(
    dashedSegments.length === 3 &&
      dashedSegments[0]?.[0]?.x === 0 &&
      dashedSegments[0]?.at(-1)?.x === 2 &&
      dashedSegments[1]?.[0]?.x === 4 &&
      dashedSegments[2]?.at(-1)?.x === 10,
    "Dashed SVG strokes should split the path into dash subsegments before tessellation.",
  ).toBeTruthy();
  const dashedSquare = buildSketchPolylineStrokeGeometry({
    points: linePoints,
    isClosed: false,
    materialConfig: {
      ...baseConfig,
      linePattern: "dashed",
      lineCap: "square",
      dashSize: 2,
      gapSize: 2,
    },
    worldUnitsPerPixel: 1,
  });
  expect(
    hasPositionX(dashedSquare, 3) &&
      hasPositionX(dashedSquare, 7) &&
      getPositionCount(dashedSquare) > getPositionCount(square),
    "Dashed strokes should apply caps to every dash segment, not only to the whole path.",
  ).toBeTruthy();

  const longDatumGuideStroke = buildSketchPolylineStrokeGeometry({
    points: [
      [-10, 0, 0],
      [10, 0, 0],
    ],
    isClosed: false,
    materialConfig: {
      ...baseConfig,
      linePattern: "dashed",
      lineCap: "round",
      lineJoin: "round",
      dashSize: 0.24,
      gapSize: 0.14,
    },
    worldUnitsPerPixel: 0.02,
  });
  expect(
    getPositionCount(longDatumGuideStroke) <= 13_200,
    "Long active sketch dashed guides should cap mesh dash tessellation instead of emitting thousands of tiny dash strokes.",
  ).toBeTruthy();
});

function getGeometryBounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  expect(
    geometry.boundingBox,
    "Expected stroke geometry to have bounds.",
  ).toBeTruthy();
  return geometry.boundingBox;
}

function getPositionCount(geometry: THREE.BufferGeometry) {
  return geometry.getAttribute("position").count;
}

function hasPositionX(geometry: THREE.BufferGeometry, expected: number) {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    if (nearlyEqual(position.getX(index), expected)) {
      return true;
    }
  }
  return false;
}

function getStrokeWorldHeight(bounds: THREE.Box3) {
  return bounds.max.y - bounds.min.y;
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= 1e-6;
}

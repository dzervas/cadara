import { expect, test } from "vitest";
import * as THREE from "three";

import {
  FIXTURE_SKETCH_ID,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createSketchSessionFromSnapshot,
  type SketchSessionDisplayRenderable,
  type SketchSessionState
} from "@/core/editor/sketch-session";
import { getSketchSessionDisplayRenderables } from "@/infrastructure/editor/sketch-session/display";
import {
  getSketchRevealedHandleEntityIds,
  getSketchRevealedPointIds,
  type SketchPointMarkerContext,
} from "@/infrastructure/editor/sketch-session/display";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import { getSketchSessionDisplayDefinition } from "@/core/editor/sketch-session/session-definition";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { resolveSketchPickStack } from "@/core/sketch-interaction/pick-stack";
import { toSketchPickStackCandidates } from "@/infrastructure/viewport/render-picking";
import {
  collectProjectedSketchCurveCandidates,
  collectProjectedSketchDisplayPointCandidates,
} from "@/components/cad/three-cad-viewport-pick-candidates";
import {
  getSketchDisplayMarkerPresentation,
  getSketchDisplayMarkerMaterialConfig,
  getSketchDisplayPolylineMaterialConfig,
  getActiveSketchMarkerWorldRadii,
  ACTIVE_SKETCH_FEEDBACK_PIXEL_BOUNDS,
  createScreenSpacePointMarkerGeometry,
  updateScreenSpacePointMarker,
  SKETCH_POINT_HOVER_MARKER_SCALE,
  type SketchMarkerDisplayContext,
} from "@/components/cad/sketch-display-style";

// Lane: ui (docs/testing.md). Seam: the sketch marker node's presentation
// (`getSketchDisplayMarkerPresentation` from `sketch-display-style.ts`,
// T11-D8) fed with the session's display renderables and the viewport's
// sketch pick stack, composed from the projected point and curve collectors
// as the viewport composes them.
// The repository has no R3F renderer, so the node's `visible` and radius
// come from this one exported helper.

const pointId = (name: string) => `sketch_point_${name}` as SketchPointId;
const entityRef = (name: string): PrimitiveRef => ({
  kind: "sketchEntity",
  sketchId: FIXTURE_SKETCH_ID,
  entityId: `sketch_entity_${name}` as SketchEntityId,
});

/**
 * A line from (−4, 0.5) to (4, 0.5) over a construction line from (−4, 0)
 * to (4, 0); a free point at (−6, 5). Top view, 10 px per unit: sketch
 * (x, y) is at screen (100 + 10x, 100 − 10y).
 */
function markerSession(): SketchSessionState {
  const sketch = makeSketchFixture();
  sketch.point("la", -4, 0.5);
  sketch.point("lb", 4, 0.5);
  sketch.line("line", "la", "lb");
  sketch.point("ca", -4, 0);
  sketch.point("cb", 4, 0);
  sketch.line("construction", "ca", "cb", true);
  sketch.point("free", -6, 5);
  return enterSketchSession(
    createSketchSessionFromSnapshot(
      sketchSnapshotRecordForTest(
        sketch.build(),
        [],
        createStandardPlaneDefinition("xy"),
      ),
      OCC_KERNEL_SETTINGS,
    ),
  );
}

function hoverStackAt(
  session: SketchSessionState,
  renderables: SketchSessionDisplayRenderable[],
  clientX: number,
  clientY: number,
) {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const displayDefinition = getSketchSessionDisplayDefinition(session);
  const shared = {
    clientX,
    clientY,
    camera,
    viewportRect: {
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    } as DOMRectReadOnly,
    acceptsTarget: () => true,
    currentHoverTarget: null,
  };
  return resolveSketchPickStack({
    session,
    displayDefinition,
    candidates: toSketchPickStackCandidates(
      [
        ...collectProjectedSketchDisplayPointCandidates({
          ...shared,
          sketchDisplayRenderables: renderables,
        }),
        ...collectProjectedSketchCurveCandidates({
          ...shared,
          sketchSession: session,
          displayDefinition,
        }),
      ],
      { excludeBackgroundDatumPlanes: true },
    ),
    acceptsTarget: () => true,
  }).map((entry) => entry.target);
}

function marker(renderables: SketchSessionDisplayRenderable[], name: string) {
  const found = renderables.find(
    (renderable) =>
      renderable.geometry.kind === "marker" &&
      renderable.target?.kind === "sketchPoint" &&
      renderable.target.pointId === pointId(name),
  );
  if (!found) throw new Error(`No marker for ${name}.`);
  return found;
}

/** The marker context as the viewport's memo builds it (T11f review A-3). */
const context = (
  renderables: SketchSessionDisplayRenderable[],
  partial: Partial<SketchPointMarkerContext>,
): SketchMarkerDisplayContext => {
  const full: SketchPointMarkerContext = {
    hoverStack: [],
    hoverTarget: null,
    selection: [],
    toolPointIds: new Set(),
    ...partial,
  };
  return {
    revealedPointIds: getSketchRevealedPointIds(renderables, full),
    revealedHandleEntityIds: getSketchRevealedHandleEntityIds(
      renderables,
      full,
    ),
    hoverTarget: full.hoverTarget,
  };
};

test("T11f: the nodes draw only visible markers; a hidden marker's point is still the top of the pick stack", () => {
  const session = markerSession();
  const renderables = getSketchSessionDisplayRenderables(session);
  const shown = (name: string, partial: Partial<SketchPointMarkerContext>) =>
    getSketchDisplayMarkerPresentation(
      marker(renderables, name),
      context(renderables, partial),
    ).visible;

  // Nothing hovered or selected: curve points are hidden; the free point
  // and the datum origin are drawn.
  expect(
    ["la", "lb", "ca", "cb", "free"].map((name) => shown(name, {})),
    "Only the free point's marker is drawn with nothing hovered or selected.",
  ).toEqual([false, false, false, false, true]);
  const origin = renderables.find(
    (renderable) =>
      renderable.target?.kind === "sketchDatumReference" &&
      renderable.target.datumId === "origin",
  )!;
  expect(
    getSketchDisplayMarkerPresentation(origin, context(renderables, {}))
      .visible,
    "The datum origin's marker is always drawn.",
  ).toBe(true);

  // Hidden, yet pickable: the pointer on the line's end point (140, 95)
  // gets that point as the stack's top.
  const atEnd = hoverStackAt(session, renderables, 140, 95);
  expect(
    atEnd[0],
    "The hidden marker's point is the first pick within its radius.",
  ).toEqual(marker(renderables, "lb").target);
  expect(shown("lb", { hoverStack: atEnd }), "Hovering there reveals it.").toBe(
    true,
  );
});

test("T11f: every hover-stack entry, not only the top, reveals its curve's markers", () => {
  const session = markerSession();
  const renderables = getSketchSessionDisplayRenderables(session);
  // Mid-span, 2.5 px from both lines: the line is the top, the
  // construction line a non-top entry (then the X axis).
  const stack = hoverStackAt(session, renderables, 120, 97.5);
  expect(
    stack.slice(0, 2),
    "premise: line on top, construction second",
  ).toEqual([entityRef("line"), entityRef("construction")]);
  expect(
    ["la", "lb", "ca", "cb", "free"].map(
      (name) =>
        getSketchDisplayMarkerPresentation(
          marker(renderables, name),
          context(renderables, { hoverStack: stack }),
        ).visible,
    ),
    "Both lines' end points are drawn; the hover target alone would show only the line's.",
  ).toEqual([true, true, true, true, true]);
  expect(
    getSketchDisplayMarkerPresentation(
      marker(renderables, "ca"),
      context(renderables, { hoverTarget: stack[0]! }),
    ).visible,
    "premise: the hover target alone does not reveal the construction line's points",
  ).toBe(false);

  // Away from both, the stack is empty and the markers hide again.
  const away = hoverStackAt(session, renderables, 120, 40);
  expect(away).toEqual([]);
  expect(
    getSketchDisplayMarkerPresentation(
      marker(renderables, "lb"),
      context(renderables, { hoverStack: away }),
    ).visible,
  ).toBe(false);
});

test("T11f: a hovered point's marker is drawn larger than its curve's other points", () => {
  const session = markerSession();
  const renderables = getSketchSessionDisplayRenderables(session);
  const end = marker(renderables, "lb");
  const hovered = context(renderables, {
    hoverStack: [end.target!, entityRef("line")],
    hoverTarget: end.target,
  });

  expect(getSketchDisplayMarkerPresentation(end, hovered)).toEqual({
    visible: true,
    radiusScale: SKETCH_POINT_HOVER_MARKER_SCALE,
  });
  expect(SKETCH_POINT_HOVER_MARKER_SCALE).toBeGreaterThan(1);
  expect(
    getSketchDisplayMarkerPresentation(marker(renderables, "la"), hovered),
    "The line's other end point is drawn at its normal size.",
  ).toEqual({ visible: true, radiusScale: 1 });
  expect(
    getSketchDisplayMarkerPresentation(
      end,
      context(renderables, { hoverTarget: entityRef("line") }),
    ),
    "Hovering the line draws its end points at their normal size.",
  ).toEqual({ visible: true, radiusScale: 1 });
});

function standalonePointRenderables(isConstruction = false) {
  const session = markerSession();
  const target = entityRef("standalone");
  if (target.kind !== "sketchEntity") throw new Error("Expected entity ref.");
  const definition = {
    ...session.definition,
    entities: [
      ...session.definition.entities,
      {
        kind: "point" as const,
        entityId: target.entityId,
        target,
        label: "Standalone point",
        pointId: pointId("free"),
        isConstruction,
      },
    ],
  };
  return getSketchSessionDisplayRenderables({ ...session, definition });
}

const markerPalette = {
  constrained: 0xffffff,
  underconstrained: 0x228be6,
  overconstrained: 0xff0000,
  regionFill: 0x444444,
};

test("standalone Point surrounds an endpoint-sized fill with a separate screen-space ring", () => {
  const renderables = standalonePointRenderables();
  const ring = renderables.find((entry) => entry.markerShape === "ring")!;
  expect(ring.markerShape).toBe("ring");
  expect(ring.geometry.kind).toBe("marker");
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  for (const zoom of [0.25, 1, 20]) {
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    const fill = getActiveSketchMarkerWorldRadii(
      marker(renderables, "free"),
      camera,
      1000,
    );
    const endpoint = getActiveSketchMarkerWorldRadii(
      marker(renderables, "la"),
      camera,
      1000,
    );
    const outline = getActiveSketchMarkerWorldRadii(ring, camera, 1000);
    expect(fill.visiblePixelRadius).toBeCloseTo(4.48);
    expect(fill.visiblePixelRadius).toBe(endpoint.visiblePixelRadius);
    expect(outline.visiblePixelRadius).toBe(fill.visiblePixelRadius);
    for (const name of ["free", "la"]) {
      const point = marker(renderables, name);
      expect(point.markerLayer).not.toBe("overlay");
      for (const hovered of [false, true]) {
        const presentation = getSketchDisplayMarkerPresentation(
          point,
          context(renderables, {
            hoverTarget: hovered ? point.target : entityRef("line"),
            selection: [point.target!],
          }),
        );
        expect(presentation.visible).toBe(true);
        const dot = createScreenSpacePointMarkerGeometry(
          fill.visiblePixelRadius,
          false,
        );
        expect(
          (dot as THREE.CircleGeometry).parameters.radius *
            presentation.radiusScale,
        ).toBeCloseTo(hovered ? 6.72 : 4.48);
        dot.dispose();
      }
    }
    const geometry = createScreenSpacePointMarkerGeometry(
      outline.visiblePixelRadius,
      true,
    );
    expect(geometry).toBeInstanceOf(THREE.RingGeometry);
    const { innerRadius, outerRadius } = (geometry as THREE.RingGeometry)
      .parameters;
    expect(innerRadius).toBeCloseTo(8.96);
    expect(outerRadius - innerRadius).toBe(1);
    expect(innerRadius - fill.visiblePixelRadius).toBeCloseTo(4.48);
    geometry.dispose();
  }
});

test("construction Point ring uses the construction circle's dash-dot stroke, not a solid marker fill", () => {
  const renderables = standalonePointRenderables(true);
  const ring = renderables.find((entry) => entry.markerShape === "ring")!;
  const construction = renderables.find(
    (entry) =>
      entry.target?.kind === "sketchEntity" &&
      entry.target.entityId === "sketch_entity_construction",
  )!;
  const stroke = getSketchDisplayPolylineMaterialConfig(
    ring,
    true,
    markerPalette,
  );
  const constructionStroke = getSketchDisplayPolylineMaterialConfig(
    construction,
    true,
    markerPalette,
  );
  expect(stroke).toEqual(constructionStroke);
  expect([
    stroke.linePattern,
    stroke.dashSize,
    stroke.gapSize,
    stroke.dotSize,
  ]).toEqual(["dash-dot", 12, 5, 1]);
  expect(
    getSketchDisplayMarkerMaterialConfig(ring, true, markerPalette),
  ).toEqual({
    color: stroke.color,
    opacity: stroke.opacity,
    transparent: true,
  });

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  const radius = getActiveSketchMarkerWorldRadii(
    ring,
    camera,
    1000,
  ).visiblePixelRadius;
  const geometry = createScreenSpacePointMarkerGeometry(radius, true, stroke);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const hits = Array.from({ length: 360 }, (_, degrees) => {
    const angle = THREE.MathUtils.degToRad(degrees);
    const centerRadius = radius * 2 + 0.5;
    ray.set(
      new THREE.Vector3(
        centerRadius * Math.cos(angle),
        centerRadius * Math.sin(angle),
        1,
      ),
      new THREE.Vector3(0, 0, -1),
    );
    return ray.intersectObject(mesh).length > 0;
  });
  expect(hits.filter(Boolean).length).toBeGreaterThan(120);
  expect(
    hits.filter((hit) => !hit).length,
    "Construction has visible gaps in the rendered ring.",
  ).toBeGreaterThan(30);
  geometry.dispose();
  material.dispose();
});

test("origin markers are flat and retain compact pixel radii through zoom and oblique views", () => {
  const renderables = getSketchSessionDisplayRenderables(markerSession());
  const origin = renderables.find(
    (entry) =>
      entry.target?.kind === "sketchDatumReference" &&
      entry.target.datumId === "origin",
  )!;
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  camera.position.set(10, -10, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const endpoint = getActiveSketchMarkerWorldRadii(
    marker(renderables, "la"),
    camera,
    1000,
  );
  const datum = getActiveSketchMarkerWorldRadii(origin, camera, 1000);
  expect(datum.visiblePixelRadius).toBe(endpoint.visiblePixelRadius);
  for (const radius of [
    ACTIVE_SKETCH_FEEDBACK_PIXEL_BOUNDS.marker.default.min,
    datum.visiblePixelRadius,
  ]) {
    const geometry = createScreenSpacePointMarkerGeometry(radius, false);
    expect(geometry).toBeInstanceOf(THREE.CircleGeometry);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.z).toBe(0);
    expect(geometry.boundingBox!.max.z).toBe(0);
    const mesh = new THREE.Mesh(geometry);
    for (const zoom of [0.25, 1, 20]) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      updateScreenSpacePointMarker(mesh, camera, 1000, [0, 0, 0], 1);
      expect(mesh.quaternion.equals(camera.quaternion)).toBe(true);
      const pixelsPerUnit = (1000 * zoom) / (camera.top - camera.bottom);
      expect(radius * mesh.scale.x * pixelsPerUnit).toBeCloseTo(radius);
    }
    geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
});

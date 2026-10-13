import type { Page } from "@playwright/test";

import type { CanvasPoint } from "./acceptance";
import { glideClick, type MirrorSketchSnapshot } from "./mirror-workbench";
import type { SketchWorkbenchHarness } from "./sketch-workbench";

// Shared pieces of the specification §2 "Mixed curves and trustworthy
// topology" flow (T17 E2E-2, `e2e/acceptance-mixed-topology.spec.ts`):
// sketch ↔ canvas maps (the Top plane while editing, the projected map in
// part mode), the tangent-handle search, the pick cycle, and dense samples
// of the edit-mode geometry (from the debug read) to compare with what part
// mode draws.

export type Vec = readonly [number, number];
export type Poles = readonly Vec[];

/** The live sketch snapshot with the T17i spline/arc fields. */
export type MixedSketchSnapshot = Omit<MirrorSketchSnapshot, "entities"> & {
  entities: (MirrorSketchSnapshot["entities"][number] & {
    sweepDirection?: string;
    closure?: string;
    spans?: Poles[];
    occurrences?: {
      occId: string;
      pointId: string;
      tangent: { kind: string; vector?: Vec };
      visibleVector?: Vec | null;
    }[];
  })[];
};

export async function mixedSnapshot(page: Page): Promise<MixedSketchSnapshot> {
  const snap = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snap) throw new Error("No live sketch snapshot.");
  return snap as unknown as MixedSketchSnapshot;
}

/**
 * The Top plane in the default sketch view: sketch (x, y) ↔ canvas, origin
 * at the canvas centre, Y up, `scale` px per unit (read off two drawn
 * points, never assumed).
 */
export function topPlaneMap(scale: number, origin: CanvasPoint) {
  return {
    scale,
    toCanvas: ([x, y]: Vec): CanvasPoint => ({
      x: origin.x + x * scale,
      y: origin.y - y * scale,
    }),
  };
}

/** Viewport-surface coordinates (`__cadProjectToScreen`) → canvas. */
export async function surfaceToCanvasShift(workbench: SketchWorkbenchHarness) {
  const surface = (await workbench.viewportSurface().boundingBox())!;
  const canvas = (await workbench.viewport().boundingBox())!;
  return { x: surface.x - canvas.x, y: surface.y - canvas.y };
}

/**
 * Sketch (x, y) → canvas under the current camera (any orthographic view):
 * the affine map through three projected sketch points of `sketchId`
 * (`__cadProjectToScreen`, a debug read in viewport-surface coordinates,
 * shifted onto the canvas) whose positions are known.
 */
export async function projectedSketchMap(
  workbench: SketchWorkbenchHarness,
  sketchId: string,
  known: readonly { pointId: string; position: Vec }[],
) {
  const page = workbench.page;
  const shift = await surfaceToCanvasShift(workbench);
  const screen = await page.evaluate(
    (ids) => ids.map((id) => window.__cadProjectToScreen?.(id) ?? null),
    known.map((entry) => `${sketchId}.${entry.pointId}`),
  );
  if (screen.some((point) => point === null))
    throw new Error(`Unprojected points of ${sketchId}.`);
  const [p0, p1, p2] = known.map((entry) => entry.position);
  const [s0, s1, s2] = screen as CanvasPoint[];
  // Solve [s − s0] = J [p − p0] from two difference vectors.
  const a = [p1![0] - p0![0], p1![1] - p0![1]];
  const b = [p2![0] - p0![0], p2![1] - p0![1]];
  const det = a[0]! * b[1]! - a[1]! * b[0]!;
  if (Math.abs(det) < 1e-9) throw new Error("Collinear map points.");
  const inverse = [
    [b[1]! / det, -b[0]! / det],
    [-a[1]! / det, a[0]! / det],
  ];
  const du = [s1!.x - s0!.x, s2!.x - s0!.x];
  const dv = [s1!.y - s0!.y, s2!.y - s0!.y];
  const jx = [
    du[0]! * inverse[0]![0]! + du[1]! * inverse[1]![0]!,
    du[0]! * inverse[0]![1]! + du[1]! * inverse[1]![1]!,
  ];
  const jy = [
    dv[0]! * inverse[0]![0]! + dv[1]! * inverse[1]![0]!,
    dv[0]! * inverse[0]![1]! + dv[1]! * inverse[1]![1]!,
  ];
  return ([x, y]: Vec): CanvasPoint => ({
    x: shift.x + s0!.x + jx[0]! * (x - p0![0]) + jx[1]! * (y - p0![1]),
    y: shift.y + s0!.y + jy[0]! * (x - p0![0]) + jy[1]! * (y - p0![1]),
  });
}

export const positionOf = (snap: MirrorSketchSnapshot, id: string): Vec => {
  const point = snap.points.find((candidate) => candidate.id === id);
  if (!point) throw new Error(`No point ${id}.`);
  return point.position;
};

export const entityOfKind = (snap: MixedSketchSnapshot, kind: string) => {
  const entity = snap.entities.find((candidate) => candidate.kind === kind);
  if (!entity) throw new Error(`No ${kind}.`);
  return entity;
};

/**
 * Hovers a radial scan around `around` (no press) until the hover target
 * is a tangent handle accepted by `accept` (a handle target has three
 * dotted parts: sketch, entity, occurrence). The spline must be selected
 * or hovered so its handles are revealed.
 */
export async function findHandleNear(
  workbench: SketchWorkbenchHarness,
  around: CanvasPoint,
  accept: (label: string) => boolean = () => true,
): Promise<{ at: CanvasPoint; label: string }> {
  const canvas = (await workbench.viewport().boundingBox())!;
  for (let radius = 20; radius <= 120; radius += 6)
    for (let angle = 0; angle < 360; angle += 10) {
      const at = {
        x: Math.round(around.x + radius * Math.cos((angle * Math.PI) / 180)),
        y: Math.round(around.y + radius * Math.sin((angle * Math.PI) / 180)),
      };
      await workbench.page.mouse.move(canvas.x + at.x, canvas.y + at.y, {
        steps: 2,
      });
      await workbench.waitForAnimationFrames(2);
      const label = await workbench.currentHoverTarget();
      if (label.split(".").length === 3 && accept(label)) return { at, label };
    }
  throw new Error(`No tangent handle near ${JSON.stringify(around)}.`);
}

/**
 * Repeated gliding clicks on one spot (the pick cycle) until the editor
 * selection is `label`; fails after `max` clicks.
 */
export async function cycleUntilSelected(
  workbench: SketchWorkbenchHarness,
  at: CanvasPoint,
  label: string,
  max = 6,
) {
  const seen: string[] = [];
  for (let click = 0; click < max; click += 1) {
    await glideClick(workbench, at);
    await workbench.waitForAnimationFrames(2);
    const selected = await workbench.currentEditorSelection();
    seen.push(selected);
    if (selected === label) return;
  }
  throw new Error(
    `The pick cycle at ${JSON.stringify(at)} never selected ${label}: ${JSON.stringify(seen)}.`,
  );
}

// ── Exact geometry from the edit-mode read ──────────────────────────────

const bezier = (poles: Poles, t: number): Vec => {
  const s = 1 - t;
  const w = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
  return [
    w.reduce((sum, weight, index) => sum + weight * poles[index]![0], 0),
    w.reduce((sum, weight, index) => sum + weight * poles[index]![1], 0),
  ];
};
export const bezierPoint = bezier;

const SAMPLES = 2000;
/** The display tessellation's samples per span (`tessellateCubicSpans`). */
export const DISPLAY_SAMPLES_PER_SPAN = 16;

/** Samples of cubic Bézier spans at `samples` equal parameter steps each. */
export const sampleSpans = (spans: readonly Poles[], samples = SAMPLES) =>
  spans.flatMap((poles) =>
    Array.from({ length: samples + 1 }, (_, index) =>
      bezier(poles, index / samples),
    ),
  );

/** The centre of the axis-aligned bounding box of `points`. */
export function boxCentre(points: readonly Vec[]): Vec {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
}

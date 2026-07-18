/**
 * Shared projection of a read Onshape solved sketch into a cadara sketch commit
 * definition. Used by the provider (to emit `commitSketch` actions) and by the
 * extrude planner (to run review-time region verification over the *translated*
 * solved sketch). Keeping one projection means the geometry the planner verifies
 * is exactly the geometry the provider commits.
 */
import type { SketchPlaneFrame, SketchPlaneKey } from "@/contracts/shared/sketch-plane";

import type {
  OnshapeSketchConstraint,
  OnshapeSolvedSketch,
} from "@/domain/import/onshape/bundle-reader";
import {
  projectPointToPlane,
  projectPointToSketchPlaneFrame,
  translateSketch,
  type SketchTranslationResult,
  type SolvedSketchEntityGeometry,
} from "@/domain/import/onshape/sketch-translator";

// Onshape radii/positions are in meters; sketch units are millimeters.
const METERS_TO_MM = 1000;

export function translateSolvedSketch(input: {
  solved: OnshapeSolvedSketch;
  featureId: string;
  label: string;
  planeKey: SketchPlaneKey;
  planeFrame?: SketchPlaneFrame;
  constraints?: readonly OnshapeSketchConstraint[];
}): SketchTranslationResult {
  const entities: SolvedSketchEntityGeometry[] = input.solved.entities.map(
    (curve) => ({
      entityId: curve.entityId,
      entityType: curve.entityType,
      isConstruction: curve.isConstruction,
      start: curve.start3d
        ? input.planeFrame
          ? projectPointToSketchPlaneFrame(curve.start3d, input.planeFrame)
          : projectPointToPlane(curve.start3d, input.planeKey)
        : undefined,
      end: curve.end3d
        ? input.planeFrame
          ? projectPointToSketchPlaneFrame(curve.end3d, input.planeFrame)
          : projectPointToPlane(curve.end3d, input.planeKey)
        : undefined,
      center: curve.center3d
        ? input.planeFrame
          ? projectPointToSketchPlaneFrame(curve.center3d, input.planeFrame)
          : projectPointToPlane(curve.center3d, input.planeKey)
        : undefined,
      radius: curve.radius === undefined ? undefined : curve.radius * METERS_TO_MM,
    }),
  );
  return translateSketch({
    featureId: input.featureId,
    label: input.label,
    planeKey: input.planeKey,
    entities,
    constraints: input.constraints,
    sourceSolveStatus: input.solved.sketchSolveStatus,
  });
}

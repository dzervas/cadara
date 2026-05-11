import type { FaceId } from "@/contracts/shared/ids";
import type {
  SketchPlaneDefinition,
  SketchPlaneFrame,
} from "@/contracts/shared/sketch-plane";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import {
  dot,
  magnitude,
  mapSketchPointToWorld as mapPointWithFrame,
  mapWorldPointToSketch as mapPointToSketchWithFrame,
  normalize,
  type Vec3,
} from "@/domain/modeling/occ/math";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";

const UNIT_TOLERANCE = 1e-6;
const ORTHOGONAL_TOLERANCE = 1e-6;

export type SketchPlaneFrameInput = SketchPlaneDefinition | SketchPlaneFrame;

export interface OpenCascadePlaneAxes {
  origin: InstanceType<OpenCascadeInstance["gp_Pnt_3"]>;
  normal: InstanceType<OpenCascadeInstance["gp_Dir_4"]>;
  xDirection: InstanceType<OpenCascadeInstance["gp_Dir_4"]>;
  axis: InstanceType<OpenCascadeInstance["gp_Ax3_3"]>;
}

export interface ExtractedPlanarFaceData {
  frame: SketchPlaneFrame;
  plane: ReturnType<
    InstanceType<OpenCascadeInstance["BRepAdaptor_Surface_2"]>["Plane"]
  >;
}

function getFrame(input: SketchPlaneFrameInput): SketchPlaneFrame {
  return "frame" in input ? input.frame : input;
}

export function toGpPnt(oc: OpenCascadeInstance, point: Vec3) {
  return new oc.gp_Pnt_3(point[0], point[1], point[2]);
}

export function toGpDir(oc: OpenCascadeInstance, vector: Vec3) {
  const unit = normalize(vector);
  return new oc.gp_Dir_4(unit[0], unit[1], unit[2]);
}

export function toGpVec(oc: OpenCascadeInstance, vector: Vec3) {
  return new oc.gp_Vec_4(vector[0], vector[1], vector[2]);
}

export function toVec3FromGpPoint(point: {
  X(): number;
  Y(): number;
  Z(): number;
}): Vec3 {
  return [point.X(), point.Y(), point.Z()];
}

function assertUnitLength(vector: Vec3, label: string) {
  if (Math.abs(magnitude(vector) - 1) > UNIT_TOLERANCE) {
    throw new Error(`Sketch plane frame ${label} must be unit length.`);
  }
}

export function assertValidSketchPlaneFrame(frame: SketchPlaneFrame) {
  assertUnitLength(frame.xAxis, "xAxis");
  assertUnitLength(frame.yAxis, "yAxis");
  assertUnitLength(frame.normal, "normal");

  if (Math.abs(dot(frame.xAxis, frame.yAxis)) > ORTHOGONAL_TOLERANCE) {
    throw new Error("Sketch plane frame xAxis and yAxis must be orthogonal.");
  }

  if (Math.abs(dot(frame.xAxis, frame.normal)) > ORTHOGONAL_TOLERANCE) {
    throw new Error("Sketch plane frame xAxis and normal must be orthogonal.");
  }

  if (Math.abs(dot(frame.yAxis, frame.normal)) > ORTHOGONAL_TOLERANCE) {
    throw new Error("Sketch plane frame yAxis and normal must be orthogonal.");
  }

  const expectedNormal = normalize([
    frame.xAxis[1] * frame.yAxis[2] - frame.xAxis[2] * frame.yAxis[1],
    frame.xAxis[2] * frame.yAxis[0] - frame.xAxis[0] * frame.yAxis[2],
    frame.xAxis[0] * frame.yAxis[1] - frame.xAxis[1] * frame.yAxis[0],
  ]);

  if (dot(expectedNormal, frame.normal) < 1 - ORTHOGONAL_TOLERANCE) {
    throw new Error(
      "Sketch plane frame must be right-handed with normal = xAxis x yAxis.",
    );
  }
}

export function mapSketchPointToWorld(
  input: SketchPlaneFrameInput,
  point: SketchPoint2D,
): Vec3 {
  const frame = getFrame(input);
  assertValidSketchPlaneFrame(frame);

  return mapPointWithFrame(frame, point);
}

export function mapWorldPointToSketch(
  input: SketchPlaneFrameInput,
  point: Vec3,
): SketchPoint2D {
  const frame = getFrame(input);
  assertValidSketchPlaneFrame(frame);

  return mapPointToSketchWithFrame(frame, point);
}

export function getSignedDistanceToSketchPlane(
  input: SketchPlaneFrameInput,
  point: Vec3,
) {
  const frame = getFrame(input);
  assertValidSketchPlaneFrame(frame);
  const offset: Vec3 = [
    point[0] - frame.origin[0],
    point[1] - frame.origin[1],
    point[2] - frame.origin[2],
  ];
  return dot(offset, frame.normal);
}

export function createPlaneAxes(
  oc: OpenCascadeInstance,
  input: SketchPlaneFrameInput,
): OpenCascadePlaneAxes {
  const frame = getFrame(input);
  assertValidSketchPlaneFrame(frame);

  const origin = toGpPnt(oc, frame.origin);
  const normal = toGpDir(oc, frame.normal);
  const xDirection = toGpDir(oc, frame.xAxis);
  const axis = new oc.gp_Ax3_3(origin, normal, xDirection);

  return {
    origin,
    normal,
    xDirection,
    axis,
  };
}

export function toGpAx3(oc: OpenCascadeInstance, input: SketchPlaneFrameInput) {
  return createPlaneAxes(oc, input).axis;
}

export function toGpPlane(
  oc: OpenCascadeInstance,
  input: SketchPlaneFrameInput,
) {
  return new oc.gp_Pln_2(toGpAx3(oc, input));
}

export function toGpAx1(oc: OpenCascadeInstance, input: SketchPlaneFrameInput) {
  const frame = getFrame(input);
  assertValidSketchPlaneFrame(frame);
  return new oc.gp_Ax1_2(toGpPnt(oc, frame.origin), toGpDir(oc, frame.normal));
}

export function toSketchPlaneFrameFromGpAx3(axis: {
  Location(): { X(): number; Y(): number; Z(): number };
  XDirection(): { X(): number; Y(): number; Z(): number };
  YDirection(): { X(): number; Y(): number; Z(): number };
  Direction(): { X(): number; Y(): number; Z(): number };
}): SketchPlaneFrame {
  const frame: SketchPlaneFrame = {
    origin: toVec3FromGpPoint(axis.Location()),
    xAxis: toVec3FromGpPoint(axis.XDirection()),
    yAxis: toVec3FromGpPoint(axis.YDirection()),
    normal: toVec3FromGpPoint(axis.Direction()),
    linearUnit: "documentLength",
    handedness: "rightHanded",
  };

  assertValidSketchPlaneFrame(frame);
  return frame;
}

export function toSketchPlaneFrameFromGpPlane(plane: {
  Position(): {
    Location(): { X(): number; Y(): number; Z(): number };
    XDirection(): { X(): number; Y(): number; Z(): number };
    YDirection(): { X(): number; Y(): number; Z(): number };
    Direction(): { X(): number; Y(): number; Z(): number };
  };
}): SketchPlaneFrame {
  return toSketchPlaneFrameFromGpAx3(plane.Position());
}

export function extractPlanarFaceData(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance["TopoDS_Face"]>,
  nonPlanarMessage = "Face is not planar.",
): ExtractedPlanarFaceData {
  const surface = new oc.BRepAdaptor_Surface_2(face, true);

  if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
    throw new Error(nonPlanarMessage);
  }

  const plane = surface.Plane();
  return {
    frame: toSketchPlaneFrameFromGpPlane(plane),
    plane,
  };
}

export function buildConstructionPlaneFromPlanarFace(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance["TopoDS_Face"]>,
  faceId: FaceId,
  support: SketchPlaneDefinition["support"],
): SketchPlaneDefinition {
  const { frame } = extractPlanarFaceData(
    oc,
    face,
    `Face ${faceId} is not planar.`,
  );
  return {
    support,
    frame,
    key: null,
  };
}

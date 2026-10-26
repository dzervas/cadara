import type {
  EdgeCurveMeasure,
  FaceSurfaceMeasure,
  TopologyMeasure,
  TopologyMeasureAxis,
  TopologyMeasureTarget,
  TopologyMeasureVec3,
} from "@/contracts/modeling/topology-measure";
import { withOccTemporaries } from "@/domain/modeling/occ/exact-edges";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import type { OccTrackedBody } from "@/domain/modeling/occ/topology";

type Oc = OpenCascadeInstance;
type Own = <V extends { delete?: () => void }>(value: V) => V;
type Edge = InstanceType<Oc["TopoDS_Edge"]>;
type Face = InstanceType<Oc["TopoDS_Face"]>;
type Shape = InstanceType<Oc["TopoDS_Shape"]>;
type Coordinates = { X(): number; Y(): number; Z(): number };
type Axis = { Location(): Coordinates; Direction(): Coordinates };

const FULL_TURN_TOLERANCE = 1e-9;

/**
 * Exact measures of live body topology (cadara-h026.5): each edge's curve
 * and length, each face's surface and area, each body's area and volume,
 * through BRepAdaptor and BRepGProp on the kernel shapes. Computed for the
 * requested targets only; a target that no longer resolves is omitted.
 */
export function measureOccTopology(
  oc: Oc,
  bodies: readonly OccTrackedBody[],
  targets: readonly TopologyMeasureTarget[],
): TopologyMeasure[] {
  return targets.flatMap((target): TopologyMeasure[] => {
    const body = bodies.find((entry) => entry.bodyId === target.bodyId);
    if (!body) return [];
    if (target.kind === "body") {
      return [
        {
          target,
          surfaceArea: surfaceArea(oc, body.shape),
          volume: body.bodyKind === "solid" ? volume(oc, body.shape) : null,
        },
      ];
    }
    if (target.kind === "face") {
      const face = body.facesById.get(target.faceId);
      return face
        ? [
            {
              target,
              area: surfaceArea(oc, face),
              surface: measureSurface(oc, face),
            },
          ]
        : [];
    }
    const edge = body.edgesById.get(target.edgeId);
    return edge
      ? [{ target, length: length(oc, edge), curve: measureCurve(oc, edge) }]
      : [];
  });
}

function gprop(
  oc: Oc,
  compute: (properties: InstanceType<Oc["GProp_GProps"]>) => void,
) {
  return withOccTemporaries((own) => {
    const properties = own(new oc.GProp_GProps_1());
    compute(properties);
    return properties.Mass();
  });
}

const length = (oc: Oc, shape: Shape) =>
  gprop(oc, (properties) =>
    oc.BRepGProp.LinearProperties(shape, properties, true, false),
  );

const surfaceArea = (oc: Oc, shape: Shape) =>
  gprop(oc, (properties) =>
    oc.BRepGProp.SurfaceProperties_1(shape, properties, false, false),
  );

const volume = (oc: Oc, shape: Shape) =>
  gprop(oc, (properties) =>
    oc.BRepGProp.VolumeProperties_1(shape, properties, false, false, false),
  );

function measureCurve(oc: Oc, edge: Edge): EdgeCurveMeasure {
  return withOccTemporaries((own) => {
    const curve = own(new oc.BRepAdaptor_Curve_2(edge));
    const type = curve.GetType();
    const types = oc.GeomAbs_CurveType;
    if (type === types.GeomAbs_Line) {
      const line = own(curve.Line());
      return { kind: "line", direction: vec(own(line.Direction())) };
    }
    if (type === types.GeomAbs_Circle) {
      const circle = own(curve.Circle());
      const axis = own(circle.Axis());
      return {
        kind: "circle",
        center: vec(own(circle.Location())),
        radius: circle.Radius(),
        axis: vec(own(axis.Direction())),
        isFull:
          Math.abs(
            curve.LastParameter() - curve.FirstParameter() - 2 * Math.PI,
          ) < FULL_TURN_TOLERANCE,
      };
    }
    // The production ABI does not bind gp_Elips: an ellipse is classified,
    // not parametrised.
    if (type === types.GeomAbs_Ellipse) return { kind: "ellipse" };
    if (
      type === types.GeomAbs_BSplineCurve ||
      type === types.GeomAbs_BezierCurve
    )
      return { kind: "bspline" };
    return { kind: "other" };
  });
}

function measureSurface(oc: Oc, face: Face): FaceSurfaceMeasure {
  return withOccTemporaries((own) => {
    const surface = own(new oc.BRepAdaptor_Surface_2(face, true));
    const type = surface.GetType();
    const types = oc.GeomAbs_SurfaceType;
    if (type === types.GeomAbs_Plane) {
      return {
        kind: "plane",
        normal: outwardNormal(oc, own, surface, face),
        perimeter: length(oc, face),
        polygonal: everyEdgeIsLine(oc, own, face),
      };
    }
    if (type === types.GeomAbs_Cylinder) {
      const cylinder = own(surface.Cylinder());
      return {
        kind: "cylinder",
        radius: cylinder.Radius(),
        axis: axis(own, own(cylinder.Axis())),
      };
    }
    if (type === types.GeomAbs_Cone) {
      const cone = own(surface.Cone());
      return {
        kind: "cone",
        apex: vec(own(cone.Apex())),
        semiAngleRadians: Math.abs(cone.SemiAngle()),
        axis: axis(own, own(cone.Axis())),
      };
    }
    if (type === types.GeomAbs_Sphere) {
      const sphere = own(surface.Sphere());
      return {
        kind: "sphere",
        center: vec(own(sphere.Location())),
        radius: sphere.Radius(),
      };
    }
    if (type === types.GeomAbs_Torus) {
      const torus = own(surface.Torus());
      return {
        kind: "torus",
        majorRadius: torus.MajorRadius(),
        minorRadius: torus.MinorRadius(),
        axis: axis(own, own(torus.Axis())),
      };
    }
    if (
      type === types.GeomAbs_BSplineSurface ||
      type === types.GeomAbs_BezierSurface
    )
      return { kind: "bspline" };
    return { kind: "other" };
  });
}

function everyEdgeIsLine(oc: Oc, own: Own, face: Face) {
  const explorer = own(
    new oc.TopExp_Explorer_2(
      face,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    ),
  );
  for (; explorer.More(); explorer.Next()) {
    const curve = own(
      new oc.BRepAdaptor_Curve_2(
        own(oc.TopoDS.Edge_1(own(explorer.Current()))),
      ),
    );
    if (curve.GetType() !== oc.GeomAbs_CurveType.GeomAbs_Line) return false;
  }
  return true;
}

/**
 * The surface normal D1U × D1V at the face's parametric middle, flipped for
 * a reversed face: a plane's Ax3 may be left-handed, so its main direction
 * is not reliably the surface normal.
 */
function outwardNormal(
  oc: Oc,
  own: Own,
  surface: InstanceType<Oc["BRepAdaptor_Surface"]>,
  face: Face,
): TopologyMeasureVec3 {
  const point = own(new oc.gp_Pnt_1());
  const du = own(new oc.gp_Vec_1());
  const dv = own(new oc.gp_Vec_1());
  surface.D1(
    (surface.FirstUParameter() + surface.LastUParameter()) / 2,
    (surface.FirstVParameter() + surface.LastVParameter()) / 2,
    point,
    du,
    dv,
  );
  const [ux, uy, uz] = vec(du);
  const [vx, vy, vz] = vec(dv);
  const normal: TopologyMeasureVec3 = [
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx,
  ];
  const size = Math.hypot(...normal);
  const reversed =
    (face.Orientation_1() as { value?: number }).value ===
    (oc.TopAbs_Orientation.TopAbs_REVERSED as { value?: number }).value;
  const sign = reversed ? -1 : 1;
  return normal.map(
    (component) => (sign * component) / size,
  ) as TopologyMeasureVec3;
}

function axis(own: Own, value: Axis): TopologyMeasureAxis {
  return {
    origin: vec(own(value.Location() as Coordinates & { delete(): void })),
    direction: vec(own(value.Direction() as Coordinates & { delete(): void })),
  };
}

function vec(value: Coordinates): TopologyMeasureVec3 {
  return [value.X(), value.Y(), value.Z()];
}

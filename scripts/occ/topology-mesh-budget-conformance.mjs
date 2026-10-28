// Native topology payload mesh budget conformance. Runs in Node
// (probe-custom-build.mjs) and in the heavy spec
// src/infrastructure/occ/native-topology-mesh-budget.heavy.spec.ts against the
// production assets.
//
// 1. Display tiers: BuildJson caps BRepMesh's minimum segment at the linear
//    deflection. Without it the fine tier's 2 degree angular deflection put
//    368k triangles on one 49 mm^2 fillet face of the landing wheel.
// 2. Transactions mesh their committed payload at the identity budget
//    (0.1 mm / 0.5 rad, topology.ts NATIVE_TOPOLOGY_IDENTITY_*), not at the
//    unification tolerance they receive (the modelling tolerance, 0.001 mm),
//    and that payload equals a BuildJson of the committed shape at the
//    identity budget.
export const IDENTITY_LINEAR_DEFLECTION = 0.1;
export const IDENTITY_ANGULAR_DEFLECTION = 0.5;
const FINE_LINEAR_DEFLECTION = 0.1;
const FINE_ANGULAR_DEFLECTION = (2 * Math.PI) / 180;
const MODELING_TOLERANCE = 0.001;
const FILLET_RADIUS = 0.25;
/**
 * With no segment shorter than the linear deflection d, a face of area A
 * holds at most about A/(0.43 d^2) triangles; 2A/d^2 plus a constant for
 * boundary fans leaves slack. The uncapped mesher puts 28.8k triangles on
 * each 49 mm^2 fillet torus below (budget 10.2k; capped, about 1.5k).
 */
const triangleBudget = (area, deflection) => (2 * area) / deflection ** 2 + 400;

export function runTopologyMeshBudgetConformance(oc) {
  const cases = [];
  let owned = [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const own = (value) => {
    owned.push(value);
    return value;
  };
  const run = (name, body) => {
    owned = [];
    const entry = { name, status: "running" };
    cases.push(entry);
    try {
      body(entry);
      entry.status = "pass";
    } catch (error) {
      entry.status = "error";
      entry.error = String(error?.stack ?? error);
    } finally {
      for (const value of owned.reverse())
        if (!value.isDeleted()) value.delete();
    }
  };

  /** A cylinder (r 20, h 10) whose circular edges carry a 0.25 mm fillet: two thin torus faces. */
  const filletedCylinder = () => {
    const cylinder = own(
      own(new oc.BRepPrimAPI_MakeCylinder_1(20, 10)).Shape(),
    );
    const fillet = own(
      new oc.BRepFilletAPI_MakeFillet(
        cylinder,
        oc.ChFi3d_FilletShape.ChFi3d_Rational,
      ),
    );
    const edges = own(
      new oc.TopExp_Explorer_2(
        cylinder,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; edges.More(); edges.Next()) {
      const edge = own(oc.TopoDS.Edge_1(edges.Current()));
      const curve = own(new oc.BRepAdaptor_Curve_2(edge));
      if (curve.GetType() === oc.GeomAbs_CurveType.GeomAbs_Circle)
        fillet.Add_2(FILLET_RADIUS, edge);
    }
    fillet.Build(own(new oc.Message_ProgressRange_1()));
    assert(fillet.IsDone(), "the fillet premise must build");
    return own(fillet.Shape());
  };
  const faceAreas = (shape) => {
    const faces = own(new oc.TopTools_IndexedMapOfShape_1());
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, faces);
    const areas = [];
    for (let index = 1; index <= faces.Size(); index += 1) {
      const properties = own(new oc.GProp_GProps_1());
      oc.BRepGProp.SurfaceProperties_1(
        own(faces.FindKey(index)),
        properties,
        false,
        false,
      );
      areas.push(properties.Mass());
    }
    return areas;
  };
  const meshOf = (json) => JSON.parse(json).mesh;

  run(
    "fine-tier display mesh caps segments at the linear deflection",
    (entry) => {
      const shape = filletedCylinder();
      oc.BRepTools.Clean(shape, true);
      const payload = JSON.parse(
        oc.CadaraBuildNativeTopologyPayload.BuildJson(
          shape,
          "body_budget",
          "t0001",
          FINE_LINEAR_DEFLECTION,
          FINE_ANGULAR_DEFLECTION,
        ),
      );
      const areas = faceAreas(shape);
      const faceIndexById = new Map(
        payload.topology
          .filter((record) => record.kind === "face")
          .map((record) => [record.id, record.index]),
      );
      const trianglesByFace = new Map();
      for (const faceId of payload.mesh.triangleFaceBindings)
        trianglesByFace.set(faceId, (trianglesByFace.get(faceId) ?? 0) + 1);
      entry.faces = [...trianglesByFace].map(([faceId, triangles]) => {
        const faceArea = areas[faceIndexById.get(faceId) - 1];
        return {
          triangles,
          area: Math.round(faceArea * 1000) / 1000,
          budget: Math.round(triangleBudget(faceArea, FINE_LINEAR_DEFLECTION)),
        };
      });
      for (const face of entry.faces)
        assert(
          face.triangles <= face.budget,
          `a ${face.area} mm^2 face has ${face.triangles} fine-tier triangles, budget ${face.budget}: assets predate the BuildJson minimum-segment cap (cadara-dx2k.3 A1)`,
        );
    },
  );

  run(
    "a transaction meshes its committed payload at the identity budget",
    (entry) => {
      const origin = own(new oc.gp_Pnt_3(0, 0, 0));
      const shape = own(
        own(new oc.BRepPrimAPI_MakeBox_3(origin, 60, 40, 20)).Shape(),
      );
      const transaction = own(
        oc.CadaraExecuteNativeFeatureTransaction.BuildChamferCommittedShapeTransactionWithHistory(
          shape,
          "edge_body_budget_t0001_1",
          0.2,
          "body_budget",
          "t0001",
          "t0002",
          MODELING_TOLERANCE,
          0.5,
        ),
      );
      assert(transaction.IsDone(), "the chamfer premise must build");
      const committed = meshOf(transaction.PayloadJson());
      entry.linearDeflection = committed.linearDeflection;
      entry.triangles = committed.triangleCount;
      assert(
        committed.linearDeflection === IDENTITY_LINEAR_DEFLECTION &&
          committed.angularDeflection === IDENTITY_ANGULAR_DEFLECTION,
        `transaction payload meshed at ${committed.linearDeflection}/${committed.angularDeflection}, expected ${IDENTITY_LINEAR_DEFLECTION}/${IDENTITY_ANGULAR_DEFLECTION}: assets predate the identity-budget transaction mesh (cadara-dx2k.3 B)`,
      );
      const committedShape = own(transaction.Shape());
      oc.BRepTools.Clean(committedShape, true);
      const identity = meshOf(
        oc.CadaraBuildNativeTopologyPayload.BuildJson(
          committedShape,
          "body_budget",
          "t0002",
          IDENTITY_LINEAR_DEFLECTION,
          IDENTITY_ANGULAR_DEFLECTION,
        ),
      );
      assert(
        JSON.stringify(identity) === JSON.stringify(committed),
        "the transaction payload mesh must equal BuildJson of the committed shape at the identity budget",
      );
    },
  );

  const summary = { pass: 0, error: 0 };
  for (const entry of cases)
    summary[entry.status === "pass" ? "pass" : "error"]++;
  return { cases, summary };
}

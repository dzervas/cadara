// Native tool-body transaction conformance. Runs in Node
// (probe-custom-build.mjs) against a staged or production build; the heavy
// spec src/infrastructure/occ/native-tool-body-transaction.heavy.spec.ts
// applies the same comparison to the landing models through the production
// shell executor.
//
// CadaraNativeToolBodyTransaction.BuildShellWithHistory must equal
// CadaraExecuteNativeFeatureTransaction.BuildShellCommittedShapeTransactionWithHistory
// except for its payload, which keeps only counts and diagnostics. Strict:
// IsDone, HistoryJson, the payload's counts and diagnostics, the committed
// shape's identity payload, the triangulation the committed shape carries
// (a following Boolean reads it for bounding boxes) and the payload and
// history of an intersect Boolean that consumes it.
const BODY_ID = "body_tool";
const PREVIOUS_TOKEN = "t0001";
const TOKEN = "t0002";
const MODELING_TOLERANCE = 0.001;
const ANGULAR = 0.5;

export function runToolBodyTransactionConformance(oc) {
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
  const faceIds = (shape) =>
    JSON.parse(
      oc.CadaraBuildNativeTopologyPayload.BuildJson(
        shape,
        BODY_ID,
        PREVIOUS_TOKEN,
        0.1,
        ANGULAR,
      ),
    )
      .topology.filter((record) => record.kind === "face")
      .map((record) => record.id);
  /** Node/triangle counts of the mesh each face carries now, in map order. */
  const carriedTriangulation = (shape) => {
    const map = own(new oc.TopTools_IndexedMapOfShape_1());
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
    return Array.from({ length: map.Size() }, (_, index) => {
      const location = own(new oc.TopLoc_Location_1());
      const triangulation = oc.BRep_Tool.Triangulation(
        oc.TopoDS.Face_1(map.FindKey(index + 1)),
        location,
        0,
      );
      return triangulation.IsNull()
        ? -1
        : `${triangulation.get().NbNodes()}/${triangulation.get().NbTriangles()}`;
    });
  };
  const identityPayload = (shape) => {
    oc.BRepTools.Clean(shape, true);
    return oc.CadaraBuildNativeTopologyPayload.BuildJson(
      shape,
      BODY_ID,
      TOKEN,
      0.1,
      ANGULAR,
    );
  };
  /** The shell through both entry points on `source`, each from a cleaned source. */
  const conform = (entry, makeSource, faceIdsCsv, signedThickness) => {
    assert(
      typeof oc.CadaraNativeToolBodyTransaction?.BuildShellWithHistory ===
        "function",
      "CadaraNativeToolBodyTransaction.BuildShellWithHistory is missing: assets predate the tool-body transaction (cadara-dx2k.20)",
    );
    const results = [
      oc.CadaraExecuteNativeFeatureTransaction
        .BuildShellCommittedShapeTransactionWithHistory,
      oc.CadaraNativeToolBodyTransaction.BuildShellWithHistory,
    ].map((build) => {
      const source = makeSource();
      oc.BRepTools.Clean(source, true);
      const transaction = own(
        build(
          source,
          faceIdsCsv(source),
          signedThickness,
          BODY_ID,
          PREVIOUS_TOKEN,
          TOKEN,
          MODELING_TOLERANCE,
          ANGULAR,
        ),
      );
      const shape = own(transaction.Shape());
      const result = {
        done: transaction.IsDone(),
        payload: JSON.parse(transaction.PayloadJson()),
        history: transaction.HistoryJson(),
        carried: carriedTriangulation(shape),
      };
      if (result.done && !shape.IsNull()) {
        const common = own(
          oc.CadaraExecuteNativeFeatureTransaction.BuildBooleanCommittedShapeTransactionWithHistory(
            source,
            shape,
            "intersect",
            BODY_ID,
            PREVIOUS_TOKEN,
            TOKEN,
            MODELING_TOLERANCE,
            ANGULAR,
          ),
        );
        result.boolean = [
          common.IsDone(),
          common.PayloadJson(),
          common.HistoryJson(),
          common.BooleanOperandHistoryJson(),
        ];
        result.identity = identityPayload(shape);
      }
      return result;
    });
    const [full, tool] = results;
    entry.done = full.done;
    entry.faces = full.payload.counts?.faces;
    assert(full.done === tool.done, "IsDone differs");
    assert(full.history === tool.history, "HistoryJson differs");
    if (full.done) {
      const { counts, diagnostics, topology, mesh, ...rest } = tool.payload;
      assert(
        topology === undefined && mesh === undefined,
        "the tool-body payload must carry no topology records or mesh",
      );
      assert(
        JSON.stringify({ counts, diagnostics }) ===
          JSON.stringify({
            counts: full.payload.counts,
            diagnostics: full.payload.diagnostics,
          }),
        "payload counts or diagnostics differ",
      );
      assert(
        JSON.stringify(rest) ===
          JSON.stringify({
            schemaVersion: full.payload.schemaVersion,
            source: full.payload.source,
            bodyId: full.payload.bodyId,
            topologyToken: full.payload.topologyToken,
          }),
        "payload header differs",
      );
      assert(
        JSON.stringify(full.carried) === JSON.stringify(tool.carried),
        `the committed shape carries a different triangulation: ${JSON.stringify(full.carried)} vs ${JSON.stringify(tool.carried)}`,
      );
      assert(full.identity === tool.identity, "identity payload differs");
      assert(
        JSON.stringify(full.boolean) === JSON.stringify(tool.boolean),
        "the intersect Boolean consuming the tool differs",
      );
    } else {
      assert(
        JSON.stringify(full.payload) === JSON.stringify(tool.payload),
        "failure payload differs",
      );
    }
  };

  // A box with its four vertical edges filleted: the shell offsets the
  // cylindrical corners. (Filleting every edge makes the shell transaction
  // abort natively on the current kernel, so it is not a usable premise.)
  const filletedBox = () => {
    const origin = own(new oc.gp_Pnt_3(0, 0, 0));
    const box = own(
      own(new oc.BRepPrimAPI_MakeBox_3(origin, 30, 20, 10)).Shape(),
    );
    const fillet = own(
      new oc.BRepFilletAPI_MakeFillet(
        box,
        oc.ChFi3d_FilletShape.ChFi3d_Rational,
      ),
    );
    const edges = own(
      new oc.TopExp_Explorer_2(
        box,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; edges.More(); edges.Next()) {
      const edge = own(oc.TopoDS.Edge_1(edges.Current()));
      const curve = own(new oc.BRepAdaptor_Curve_2(edge));
      if (Math.abs(own(own(curve.Line()).Direction()).Z()) > 0.9)
        fillet.Add_2(3, edge);
    }
    fillet.Build(own(new oc.Message_ProgressRange_1()));
    assert(fillet.IsDone(), "the fillet premise must build");
    return own(fillet.Shape());
  };
  /**
   * The first face whose removal the shell builds with `signedThickness`.
   * Inside only: an outside offset of this box does not reproduce its face
   * order run to run, so two builds are not comparable record by record.
   */
  const shellableFace = (signedThickness) => (source) => {
    for (const faceId of faceIds(source)) {
      const transaction = own(
        oc.CadaraExecuteNativeFeatureTransaction.BuildShellCommittedShapeTransactionWithHistory(
          source,
          faceId,
          signedThickness,
          BODY_ID,
          PREVIOUS_TOKEN,
          TOKEN,
          MODELING_TOLERANCE,
          ANGULAR,
        ),
      );
      if (transaction.IsDone()) return faceId;
    }
    throw new Error("premise: no face of the filleted box shells");
  };

  run("a filleted box shelled inside, then intersected", (entry) => {
    conform(entry, filletedBox, shellableFace(-1), -1);
    assert(entry.done && entry.faces > 0, "premise: the shell builds");
  });

  run("an unresolvable removable face: same failure payload", (entry) => {
    conform(entry, filletedBox, () => "face_body_tool_missing", -1);
    assert(!entry.done, "premise: the shell fails");
  });

  const summary = { pass: 0, error: 0 };
  for (const entry of cases)
    summary[entry.status === "pass" ? "pass" : "error"]++;
  return { cases, summary };
}

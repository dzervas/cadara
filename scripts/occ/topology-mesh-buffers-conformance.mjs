// Native topology mesh-buffer builder conformance. Runs in Node
// (probe-custom-build.mjs) against a staged or production build; the heavy
// spec src/infrastructure/occ/native-topology-mesh-buffers.heavy.spec.ts
// applies the same comparison to the landing models through the production
// adapter's display path.
//
// CadaraNativeTopologyMeshBuffers.Build must yield BuildJson's display payload
// with the mesh as typed buffers. Strict: the topology, edge, vertex,
// face-edge and diagnostic records, node and triangle counts, every triangle
// index and every triangle's face id. Positions (float32 in the buffers) and
// the deflections (exact inputs) may differ from BuildJson only by its text
// rounding: BuildJson prints doubles at the default stream precision of 6
// significant digits, so |delta| <= one unit in the 6th significant digit,
// 10^(floor(log10(max(|json|, |buffer|))) - 5). That bound covers the
// half-unit text rounding plus the float32 rounding (< 2^-24 relative).
const FINE_LINEAR_DEFLECTION = 0.1;
const FINE_ANGULAR_DEFLECTION = (2 * Math.PI) / 180;

/** One unit in the 6th significant digit of the larger magnitude. */
export function sixSignificantDigitQuantum(left, right) {
  const magnitude = Math.max(Math.abs(left), Math.abs(right));
  return magnitude === 0 ? 0 : 10 ** (Math.floor(Math.log10(magnitude)) - 5);
}

/**
 * The mesh-buffer payload in BuildJson's shape: positions as [x, y, z] per
 * node, triangle indices as [a, b, c], one face id per triangle.
 */
export function buildMeshBuffersPayload(
  oc,
  shape,
  bodyId,
  topologyToken,
  linearDeflection,
  angularDeflection,
) {
  const buffers = oc.CadaraNativeTopologyMeshBuffers.Build(
    shape,
    bodyId,
    topologyToken,
    linearDeflection,
    angularDeflection,
  );
  try {
    const payload = JSON.parse(buffers.TopologyJson());
    const nodeCount = buffers.NodeCount();
    const triangleCount = buffers.TriangleCount();
    const positionStart = buffers.PositionsAddress() / 4;
    const triangleStart = buffers.TriangleIndicesAddress() / 4;
    const faceIndexStart = buffers.TriangleFaceIndicesAddress() / 4;
    // Read the HEAP views after the last native call: memory growth replaces them.
    const floats = oc.HEAPF32;
    const words = oc.HEAPU32;
    const faceIdByIndex = new Map(
      payload.topology
        .filter((record) => record.kind === "face")
        .map((record) => [record.index, record.id]),
    );
    payload.mesh = {
      nodeCount,
      triangleCount,
      linearDeflection,
      angularDeflection,
      positions: Array.from({ length: nodeCount }, (_, node) => [
        floats[positionStart + node * 3],
        floats[positionStart + node * 3 + 1],
        floats[positionStart + node * 3 + 2],
      ]),
      triangleIndices: Array.from({ length: triangleCount }, (_, triangle) => [
        words[triangleStart + triangle * 3],
        words[triangleStart + triangle * 3 + 1],
        words[triangleStart + triangle * 3 + 2],
      ]),
      triangleFaceBindings: Array.from(
        { length: triangleCount },
        (_, triangle) =>
          faceIdByIndex.get(words[faceIndexStart + triangle]) ??
          `<missing face record ${words[faceIndexStart + triangle]}>`,
      ),
    };
    return payload;
  } finally {
    buffers.delete();
  }
}

/**
 * Differences between a BuildJson payload and a mesh-buffer payload of the
 * same shape, at most `limit` of them; empty when they conform.
 */
export function compareMeshBuffersPayload(json, buffers, limit = 10) {
  const mismatches = [];
  const report = (message) => {
    if (mismatches.length < limit) mismatches.push(message);
  };
  const { mesh: jsonMesh, ...jsonRecords } = json;
  const { mesh: buffersMesh, ...buffersRecords } = buffers;
  if (JSON.stringify(jsonRecords) !== JSON.stringify(buffersRecords))
    report("topology, edge, vertex, face-edge or diagnostic records differ");
  if (!jsonMesh || !buffersMesh) {
    if (jsonMesh !== buffersMesh) report("only one payload has a mesh");
    return mismatches;
  }
  for (const key of ["nodeCount", "triangleCount"])
    if (jsonMesh[key] !== buffersMesh[key])
      report(`${key}: ${jsonMesh[key]} vs ${buffersMesh[key]}`);
  const withinQuantum = (left, right) =>
    Math.abs(left - right) <= sixSignificantDigitQuantum(left, right);
  for (const key of ["linearDeflection", "angularDeflection"])
    if (!withinQuantum(jsonMesh[key], buffersMesh[key]))
      report(`${key}: ${jsonMesh[key]} vs ${buffersMesh[key]}`);
  const lengths = (key) => [
    jsonMesh[key]?.length ?? 0,
    buffersMesh[key]?.length ?? 0,
  ];
  for (const key of ["positions", "triangleIndices", "triangleFaceBindings"]) {
    const [left, right] = lengths(key);
    if (left !== right) report(`${key} length: ${left} vs ${right}`);
  }
  (jsonMesh.positions ?? []).forEach((point, node) => {
    const other = buffersMesh.positions?.[node];
    if (
      !other ||
      point.some((value, axis) => !withinQuantum(value, other[axis]))
    )
      report(
        `position ${node}: ${JSON.stringify(point)} vs ${JSON.stringify(other)}`,
      );
  });
  (jsonMesh.triangleIndices ?? []).forEach((triangle, index) => {
    const other = buffersMesh.triangleIndices?.[index];
    if (!other || triangle.some((value, corner) => value !== other[corner]))
      report(
        `triangle ${index}: ${JSON.stringify(triangle)} vs ${JSON.stringify(other)}`,
      );
  });
  (jsonMesh.triangleFaceBindings ?? []).forEach((faceId, index) => {
    if (faceId !== buffersMesh.triangleFaceBindings?.[index])
      report(
        `triangle ${index} face: ${faceId} vs ${buffersMesh.triangleFaceBindings?.[index]}`,
      );
  });
  return mismatches;
}

export function runTopologyMeshBuffersConformance(oc) {
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
  /** Both builders on `shape`, each on a freshly cleaned shape. */
  const conform = (entry, shape) => {
    assert(
      typeof oc.CadaraNativeTopologyMeshBuffers?.Build === "function",
      "CadaraNativeTopologyMeshBuffers.Build is missing: assets predate the mesh-buffer builder (cadara-dx2k.10)",
    );
    const build = (builder) => {
      if (!shape.IsNull()) oc.BRepTools.Clean(shape, true);
      return builder();
    };
    const json = build(() =>
      JSON.parse(
        oc.CadaraBuildNativeTopologyPayload.BuildJson(
          shape,
          "body_buffers",
          "t0001",
          FINE_LINEAR_DEFLECTION,
          FINE_ANGULAR_DEFLECTION,
        ),
      ),
    );
    const buffers = build(() =>
      buildMeshBuffersPayload(
        oc,
        shape,
        "body_buffers",
        "t0001",
        FINE_LINEAR_DEFLECTION,
        FINE_ANGULAR_DEFLECTION,
      ),
    );
    entry.triangles = json.mesh.triangleCount;
    entry.mismatches = compareMeshBuffersPayload(json, buffers);
    assert(
      entry.mismatches.length === 0,
      `the mesh-buffer payload differs from BuildJson: ${entry.mismatches.join("; ")}`,
    );
  };

  run("a filleted cylinder: curved and reversed faces", (entry) => {
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
        fillet.Add_2(1, edge);
    }
    fillet.Build(own(new oc.Message_ProgressRange_1()));
    assert(fillet.IsDone(), "the fillet premise must build");
    conform(entry, own(fillet.Shape()));
    assert(entry.triangles > 0, "premise: the shape has a mesh");
  });

  run("a compound with a located solid: node transforms", (entry) => {
    const origin = own(new oc.gp_Pnt_3(0, 0, 0));
    const box = own(own(new oc.BRepPrimAPI_MakeBox_3(origin, 6, 4, 2)).Shape());
    const cylinder = own(own(new oc.BRepPrimAPI_MakeCylinder_1(3, 5)).Shape());
    const transform = own(new oc.gp_Trsf_1());
    transform.SetTranslation_1(own(new oc.gp_Vec_4(100.25, -40.5, 7.125)));
    const moved = own(
      cylinder.Moved(own(new oc.TopLoc_Location_2(transform)), false),
    );
    const builder = own(new oc.BRep_Builder());
    const compound = own(new oc.TopoDS_Compound());
    builder.MakeCompound(compound);
    builder.Add(compound, box);
    builder.Add(compound, moved);
    conform(entry, compound);
    assert(entry.triangles > 0, "premise: the shape has a mesh");
  });

  run("a null shape: empty mesh", (entry) => {
    conform(entry, own(new oc.TopoDS_Shape()));
  });

  const summary = { pass: 0, error: 0 };
  for (const entry of cases)
    summary[entry.status === "pass" ? "pass" : "error"]++;
  return { cases, summary };
}

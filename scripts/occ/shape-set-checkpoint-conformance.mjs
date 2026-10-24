// Bit-exact native shape-set checkpoint conformance (cadara-3sq.7). Runs in
// Node (probe-custom-build.mjs) and in the browser/worker smoke against the
// production assets. Every double that the text BRep writer rounds to 15
// digits or re-derives through gp_Trsf::SetValues must come back bit for bit.
export function runShapeSetCheckpointConformance(oc) {
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
  const checkpoint = oc.CadaraNativeShapeSetCheckpoint;

  const point = (x, y, z) => own(new oc.gp_Pnt_3(x, y, z));
  const direction = (x, y, z) => own(new oc.gp_Dir_4(x, y, z));
  const box = (origin, dx, dy, dz) => {
    const maker = own(new oc.BRepPrimAPI_MakeBox_3(origin, dx, dy, dz));
    return own(maker.Shape());
  };
  const location = (configure) => {
    const trsf = own(new oc.gp_Trsf_1());
    configure(trsf);
    return own(new oc.TopLoc_Location_2(trsf));
  };
  const located = (shape, place) => own(shape.Located(place, false));
  const compound = (shapes) => {
    const builder = own(new oc.BRep_Builder());
    const root = own(new oc.TopoDS_Compound());
    builder.MakeCompound(root);
    for (const shape of shapes) builder.Add(root, shape);
    return root;
  };
  const write = (root) => {
    const result = checkpoint.Write(root);
    try {
      assert(result.IsDone(), `Write failed: ${result.ErrorMessage()}`);
      return result.Checkpoint();
    } finally {
      result.delete();
    }
  };
  const read = (text) => own(checkpoint.Read(text));
  const children = (result) =>
    Array.from({ length: result.ChildCount() }, (_, index) =>
      own(result.Child(index)),
    );

  const vertexPoints = (shape) => {
    const out = [];
    const explorer = own(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; explorer.More(); explorer.Next()) {
      const current = own(explorer.Current());
      const p = own(oc.BRep_Tool.Pnt(own(oc.TopoDS.Vertex_1(current))));
      out.push(p.X(), p.Y(), p.Z());
    }
    return out;
  };
  const transformValues = (place) => {
    const trsf = own(place.Transformation());
    return [
      ...[1, 2, 3].flatMap((row) =>
        [1, 2, 3, 4].map((column) => trsf.Value(row, column)),
      ),
      trsf.ScaleFactor(),
    ];
  };
  // The shape's own location plus every cumulative sub-shape location.
  const locationValues = (shape) => {
    const out = transformValues(own(shape.Location_1()));
    for (const type of ["TopAbs_FACE", "TopAbs_EDGE", "TopAbs_VERTEX"]) {
      const explorer = own(
        new oc.TopExp_Explorer_2(
          shape,
          oc.TopAbs_ShapeEnum[type],
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        ),
      );
      for (; explorer.More(); explorer.Next()) {
        out.push(...transformValues(own(own(explorer.Current()).Location_1())));
      }
    }
    return out;
  };
  const differences = (before, after) => {
    assert(before.length === after.length, "value counts differ");
    const changed = [];
    before.forEach((value, index) => {
      if (!Object.is(value, after[index]))
        changed.push([index, value, after[index]]);
    });
    return changed;
  };

  // Round-trips one shape: checks coordinates, locations and the re-export.
  const roundTrip = (out, shape) => {
    const written = write(compound([shape]));
    assert(
      written.startsWith(`${checkpoint.FormatVersion()}:`),
      "Write returned another format",
    );
    const result = read(written);
    assert(result.IsDone(), `Read failed: ${result.ErrorMessage()}`);
    assert(result.ChildCount() === 1, "expected one top-level shape");
    const [restored] = children(result);
    const coordinates = differences(
      vertexPoints(shape),
      vertexPoints(restored),
    );
    const locations = differences(
      locationValues(shape),
      locationValues(restored),
    );
    out.vertexCoordinates = vertexPoints(shape).length;
    out.coordinateChanges = coordinates.length;
    out.locationValues = locationValues(shape).length;
    out.locationChanges = locations.length;
    out.samples = [...coordinates, ...locations].slice(0, 4);
    assert(coordinates.length === 0, "vertex coordinates changed");
    assert(locations.length === 0, "location transformations changed");
    assert(
      restored.Orientation_1().value === shape.Orientation_1().value,
      "top-level orientation changed",
    );
    assert(
      write(own(result.Root())) === written,
      "re-written checkpoint differs from the original",
    );
    out.checkpointCharacters = written.length;
    return { written, restored };
  };

  const awkwardBox = () =>
    box(point(1 / 3, Math.PI, 1e-7 / 3), 2 / 3, Math.E, 0.1);
  const rotation = (angle, axis = direction(0, 0, 1)) =>
    location((trsf) =>
      trsf.SetRotation_1(
        own(new oc.gp_Ax1_2(point(0.1, 0.2, 0.3), axis)),
        angle,
      ),
    );

  run("unlocated-box-coordinates-beyond-15-digits", (out) => {
    roundTrip(out, awkwardBox());
  });
  run("rotated-location", (out) => {
    roundTrip(out, located(box(point(0, 0, 0), 1, 2, 3), rotation(1.234567)));
  });
  run("mirrored-negative-determinant-location", (out) => {
    const mirror = location((trsf) =>
      trsf.SetMirror_3(
        own(new oc.gp_Ax2_3(point(0.3, 0.1, 0), direction(1, 1 / 3, 0))),
      ),
    );
    roundTrip(out, located(awkwardBox(), mirror));
  });
  run("scaled-compound-location", (out) => {
    const scaled = location((trsf) => {
      trsf.SetRotation_1(
        own(new oc.gp_Ax1_2(point(0, 0, 0), direction(1, 2, 3))),
        0.7,
      );
      trsf.SetScaleFactor(1.7);
      trsf.SetTranslationPart(own(new oc.gp_Vec_4(0.1, 1 / 7, -2 / 3)));
    });
    roundTrip(out, located(awkwardBox(), scaled));
  });
  run("composite-powered-and-nested-locations", (out) => {
    const first = rotation(0.3);
    const second = rotation(1.1, direction(1, 0, 1));
    const composite = own(
      own(
        own(first.Multiplied(second)).Multiplied(own(first.Powered(2))),
      ).Multiplied(own(second.Inverted())),
    );
    // Sub-shapes carry their own locations inside a located parent.
    const inner = compound([
      located(awkwardBox(), first),
      located(awkwardBox(), own(second.Powered(-3))),
    ]);
    roundTrip(out, located(inner, composite));
  });
  run("meshed-curved-solid-render-payload", (out) => {
    const axes = own(new oc.gp_Ax2_3(point(0.1, 1 / 3, 0), direction(0, 1, 1)));
    const cylinder = own(
      own(new oc.BRepPrimAPI_MakeCylinder_3(axes, Math.SQRT2, Math.PI)).Shape(),
    );
    const shape = located(cylinder, rotation(0.9));
    own(new oc.BRepMesh_IncrementalMesh_2(shape, 0.01, false, 0.2, false));
    const { restored } = roundTrip(out, shape);
    const payload = (value) =>
      oc.CadaraExecuteNativeFeatureTransaction.BuildCommittedShapePayload(
        value,
        "body_checkpoint",
        "t_checkpoint",
        0.01,
        0.2,
      );
    const exact = (value) =>
      oc.CadaraBuildNativeExactBrepPayload.BuildJson(
        value,
        "body_checkpoint",
        "t_checkpoint",
      );
    assert(payload(shape) === payload(restored), "render payload changed");
    assert(exact(shape) === exact(restored), "exact BRep payload changed");
  });
  // BRep_Tool::UVPoints of every face/edge pair (both seam orientations).
  const uvPoints = (shape) => {
    const out = [];
    const faces = own(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; faces.More(); faces.Next()) {
      const face = own(oc.TopoDS.Face_1(own(faces.Current())));
      const edges = own(
        new oc.TopExp_Explorer_2(
          face,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        ),
      );
      for (; edges.More(); edges.Next()) {
        const edge = own(oc.TopoDS.Edge_1(own(edges.Current())));
        const first = own(new oc.gp_Pnt2d_1());
        const last = own(new oc.gp_Pnt2d_1());
        oc.BRep_Tool.UVPoints_2(edge, face, first, last);
        out.push(first.X(), first.Y(), last.X(), last.Y());
      }
    }
    return out;
  };
  run("curve-on-surface-uv-points", (out) => {
    // Planar faces with slanted boolean-cut edges (2D line pcurves whose
    // direction BinTools renormalizes) and a cylinder with a seam and
    // circular cap pcurves.
    const polygon = own(
      new oc.BRepBuilderAPI_MakePolygon_4(
        point(0, 0, 0),
        point(1 / 3, Math.E, 0),
        point(-Math.PI, 2 / 7, 0),
        point(-1 / 7, -Math.SQRT2, 0),
        true,
      ),
    );
    const face = own(
      own(new oc.BRepBuilderAPI_MakeFace_15(own(polygon.Wire()), true)).Shape(),
    );
    const prism = own(
      own(
        new oc.BRepPrimAPI_MakePrism_1(
          face,
          own(new oc.gp_Vec_4(0.1, 1 / 3, 1)),
          false,
          true,
        ),
      ).Shape(),
    );
    const axes = own(new oc.gp_Ax2_3(point(0.1, 1 / 3, 0), direction(0, 1, 1)));
    const cylinder = own(
      own(new oc.BRepPrimAPI_MakeCylinder_3(axes, Math.SQRT2, Math.PI)).Shape(),
    );
    const cutter = located(
      box(point(0.2, 0.3, -1), 0.5, 0.7, 3),
      rotation(0.7, direction(1, 2, 3)),
    );
    const cut = own(
      new oc.BRepAlgoAPI_Cut_3(
        prism,
        cutter,
        own(new oc.Message_ProgressRange_1()),
      ),
    );
    const shape = compound([
      own(cut.Shape()),
      located(cylinder, rotation(0.9)),
    ]);
    const { restored } = roundTrip(out, shape);
    const changes = differences(uvPoints(shape), uvPoints(restored));
    out.uvValues = uvPoints(shape).length;
    out.uvChanges = changes.length;
    out.uvSamples = changes.slice(0, 4);
    assert(changes.length === 0, "curve-on-surface UV points changed");
  });
  run("top-level-order-orientation-and-sharing", (out) => {
    const first = awkwardBox();
    const second = located(awkwardBox(), rotation(2));
    const written = write(
      compound([first, own(first.Reversed()), second, first]),
    );
    const result = read(written);
    assert(result.IsDone(), `Read failed: ${result.ErrorMessage()}`);
    const restored = children(result);
    out.children = restored.length;
    assert(restored.length === 4, "expected four top-level shapes");
    assert(
      restored[0].IsEqual(restored[3]) &&
        restored[0].IsSame(restored[1]) &&
        !restored[0].IsEqual(restored[1]) &&
        !restored[0].IsSame(restored[2]),
      "sharing between top-level shapes changed",
    );
    assert(
      restored[1].Orientation_1().value ===
        oc.TopAbs_Orientation.TopAbs_REVERSED.value,
      "reversed top-level shape lost its orientation",
    );
    assert(
      own(result.Child(4)).IsNull() && own(result.Child(-1)).IsNull(),
      "out-of-range children must be null",
    );
  });

  const fnv1a64 = (text) => {
    let hash = 0xcbf29ce484222325n;
    for (const byte of text) {
      hash ^= BigInt(byte);
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, "0");
  };
  const decodeBody = (written) =>
    Uint8Array.from(atob(written.split(":")[2]), (character) =>
      character.charCodeAt(0),
    );
  const encode = (bytes) =>
    `${checkpoint.FormatVersion()}:${fnv1a64(bytes)}:${btoa(String.fromCharCode(...bytes))}`;
  run("malformed-input-fails-with-a-structured-error", (out) => {
    const written = write(compound([located(awkwardBox(), rotation(0.4))]));
    const body = decodeBody(written);
    assert(encode(body) === written, "test re-encoding differs from Write");
    const flipped =
      written.slice(0, -8) +
      (written.at(-8) === "A" ? "B" : "A") +
      written.slice(-7);
    const inputs = {
      empty: "",
      foreign: "DBRep_DrawableShape",
      prefixOnly: `${checkpoint.FormatVersion()}:`,
      truncated: written.slice(0, Math.floor(written.length / 2)),
      flippedBodyCharacter: flipped,
      wrongChecksum: written.replace(/:[0-9a-f]{16}:/, ":0123456789abcdef:"),
      invalidBase64: written.slice(0, -4) + "!!!!",
      // Checksummed but cut inside the exact location table, and inside the
      // BinTools stream: the native parsers themselves must reject them.
      cutLocationTable: encode(body.slice(0, 40)),
      cutShapeSet: encode(body.slice(0, Math.floor(body.length * 0.9))),
      trailingData: encode(Uint8Array.from([...body, 0])),
    };
    out.errors = {};
    for (const [name, input] of Object.entries(inputs)) {
      const result = checkpoint.Read(input);
      try {
        out.errors[name] = result.ErrorMessage();
        assert(!result.IsDone(), `${name} was accepted`);
        assert(result.ChildCount() === 0, `${name} kept shapes`);
        assert(own(result.Root()).IsNull(), `${name} kept a root`);
        assert(result.ErrorMessage().length > 0, `${name} has no message`);
      } finally {
        result.delete();
      }
      assert(result.isDeleted(), `${name} result was not released`);
    }
    const nullRoot = own(checkpoint.Write(own(new oc.TopoDS_Shape())));
    out.errors.nullRoot = nullRoot.ErrorMessage();
    assert(
      !nullRoot.IsDone() &&
        nullRoot.Checkpoint() === "" &&
        nullRoot.ErrorMessage() === "root shape is null",
      "null root must fail to write with a message",
    );
  });

  const summary = { pass: 0, error: 0 };
  for (const entry of cases)
    summary[entry.status === "pass" ? "pass" : "error"]++;
  return { cases, summary };
}

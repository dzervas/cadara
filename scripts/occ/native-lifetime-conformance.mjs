// Native wrapper-lifetime conformance for one explicit staged asset directory.
// Usage: node scripts/occ/native-lifetime-conformance.mjs /absolute/stage [results.json]
// Node only: it wraps embind class registration during instantiation and parses
// the wasm element/code sections to classify every registered raw destructor.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

if (!process.argv[2])
  throw new Error("An explicit staged custom-asset directory is required");
const directory = resolve(process.argv[2]);

// The destructor repair must not change the generated declarations or the
// embind constructor/method registry of the v8 assets.
const EXPECTED_DTS_SHA256 =
  "e30f46eca4fa30d12b6ccb16281a86d2c439433e6c4de6a43eeef623c93a8443";
const EXPECTED_ABI_SHA256 =
  "5c3617ab8ab5a10d41a5351e2ded5b472a19ece74880ece1e7a7c700bde87d8d";
// Only a non-public destructor may keep embind's no-op raw_destructor.
const NONPUBLIC_DESTRUCTOR_ALLOWLIST = [
  "BRepAlgoAPI_Algo",
  "CDM_Document",
  "IntRes2d_Intersection",
  "NCollection_BaseMap",
];
// Classes whose raw_destructor was a no-op in v8 only because
// DEFINE_STANDARD_ALLOC declares a two-argument placement operator delete.
const REPAIRED_PLACEMENT_DELETE_CLASSES = [
  "gp_Vec2d",
  "gp_Vec",
  "gp_Trsf",
  "gp_Torus",
  "gp_Sphere",
  "gp_Pnt2d",
  "gp_Pnt",
  "gp_Pln",
  "gp_Lin",
  "gp_Dir2d",
  "gp_Dir",
  "gp_Cylinder",
  "gp_Cone",
  "gp_Circ2d",
  "gp_Circ",
  "gp_Ax3",
  "gp_Ax2d",
  "gp_Ax2",
  "gp_Ax1",
  "TopoDS_Wire",
  "TopoDS_Vertex",
  "TopoDS_Solid",
  "TopoDS_Shell",
  "TopoDS_Shape",
  "TopoDS_Face",
  "TopoDS_Edge",
  "TopoDS_Compound",
  "TopoDS_Builder",
  "TopoDS",
  "TopLoc_Location",
  "TopExp_Explorer",
  "TopExp",
  "TNaming_Tool",
  "TNaming_Selector",
  "TNaming_Builder",
  "TDF_Label",
  "TCollection_ExtendedString",
  "Standard_Transient",
  "STEPControl_Writer",
  "Poly_Triangle",
  "NCollection_BaseList",
  "IntRes2d_IntersectionSegment",
  "IntRes2d_IntersectionPoint",
  "IntAna2d_IntPoint",
  "IntAna2d_AnaIntersection",
  "Geom2dInt_GInter",
  "GProp_GProps",
  "GC_Root",
  "GC_MakeCircle",
  "GC_MakeArcOfCircle",
  "BRepTools_WireExplorer",
  "BRepTools",
  "BRepPrimAPI_MakeSweep",
  "BRepPrimAPI_MakeRevol",
  "BRepPrimAPI_MakePrism",
  "BRepPrimAPI_MakeOneAxis",
  "BRepPrimAPI_MakeCylinder",
  "BRepPrimAPI_MakeBox",
  "BRepOffsetAPI_ThruSections",
  "BRepOffsetAPI_MakeThickSolid",
  "BRepOffsetAPI_MakePipeShell",
  "BRepOffsetAPI_MakePipe",
  "BRepOffsetAPI_MakeOffsetShape",
  "BRepOffsetAPI_DraftAngle",
  "BRepGProp",
  "BRepFilletAPI_MakeFillet",
  "BRepFilletAPI_MakeChamfer",
  "BRepFilletAPI_LocalOperation",
  "BRepCheck_Analyzer",
  "BRepBuilderAPI_Transform",
  "BRepBuilderAPI_NurbsConvert",
  "BRepBuilderAPI_ModifyShape",
  "BRepBuilderAPI_MakeWire",
  "BRepBuilderAPI_MakeVertex",
  "BRepBuilderAPI_MakeSolid",
  "BRepBuilderAPI_MakeShape",
  "BRepBuilderAPI_MakePolygon",
  "BRepBuilderAPI_MakeFace",
  "BRepBuilderAPI_MakeEdge",
  "BRepBuilderAPI_Command",
  "BRepAlgoAPI_Splitter",
  "BRepAlgoAPI_Fuse",
  "BRepAlgoAPI_Cut",
  "BRepAlgoAPI_Common",
  "BRepAlgoAPI_BuilderAlgo",
  "BRepAlgoAPI_BooleanOperation",
  "BRep_Tool",
  "BRep_Builder",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assets = Object.fromEntries(
  ["cadara-occ.js", "cadara-occ.wasm", "cadara-occ.d.ts"].map((name) => {
    const bytes = readFileSync(resolve(directory, name));
    return [name, { bytes: bytes.length, sha256: sha256(bytes) }];
  }),
);
const wasmBytes = readFileSync(resolve(directory, "cadara-occ.wasm"));

// ---- wasm sections: imported function count, table elements, code bodies ----
function leb(bytes, index) {
  let result = 0,
    shift = 0,
    byte;
  do {
    byte = bytes[index++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [result >>> 0, index];
}
function sleb(bytes, index) {
  let result = 0,
    shift = 0,
    byte;
  do {
    byte = bytes[index++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  if (shift < 32 && byte & 0x40) result |= -1 << shift;
  return [result, index];
}
function parseWasm(bytes) {
  let position = 8,
    importedFunctions = 0,
    code = null;
  const elementToFunction = new Map();
  while (position < bytes.length) {
    const id = bytes[position++];
    let size;
    [size, position] = leb(bytes, position);
    const end = position + size;
    let p = position,
      count;
    if (id === 2) {
      [count, p] = leb(bytes, p);
      for (let k = 0; k < count; k++) {
        let length;
        [length, p] = leb(bytes, p);
        p += length;
        [length, p] = leb(bytes, p);
        p += length;
        const kind = bytes[p++];
        let flags;
        if (kind === 0) {
          [, p] = leb(bytes, p);
          importedFunctions++;
        } else if (kind === 1) {
          p++;
          [flags, p] = leb(bytes, p);
          [, p] = leb(bytes, p);
          if (flags & 1) [, p] = leb(bytes, p);
        } else if (kind === 2) {
          [flags, p] = leb(bytes, p);
          [, p] = leb(bytes, p);
          if (flags & 1) [, p] = leb(bytes, p);
        } else if (kind === 3) p += 2;
        else throw new Error(`Unknown wasm import kind ${kind}`);
      }
    } else if (id === 9) {
      [count, p] = leb(bytes, p);
      for (let k = 0; k < count; k++) {
        let flags, offset, length, fn;
        [flags, p] = leb(bytes, p);
        if (flags !== 0)
          throw new Error(`Unsupported element segment flags ${flags}`);
        if (bytes[p++] !== 0x41)
          throw new Error("Element offset is not i32.const");
        [offset, p] = sleb(bytes, p);
        if (bytes[p++] !== 0x0b) throw new Error("Malformed element offset");
        [length, p] = leb(bytes, p);
        for (let j = 0; j < length; j++) {
          [fn, p] = leb(bytes, p);
          elementToFunction.set(offset + j, fn);
        }
      }
    } else if (id === 10) code = [position, size];
    position = end;
  }
  const bodies = [];
  let p = code[0],
    count;
  [count, p] = leb(bytes, p);
  for (let k = 0; k < count; k++) {
    let length;
    [length, p] = leb(bytes, p);
    bodies.push(bytes.subarray(p, p + length));
    p += length;
  }
  return { importedFunctions, elementToFunction, bodies };
}
const wasm = parseWasm(wasmBytes);

// ---- instantiate the staged module while recording every embind registration ----
const registrations = [];
let wasmExports = null;
const memoryBytes = () =>
  new Uint8Array(
    Object.values(wasmExports).find(
      (value) => value instanceof WebAssembly.Memory,
    ).buffer,
  );
const cString = (pointer) => {
  const memory = memoryBytes();
  let end = pointer;
  while (memory[end]) end++;
  return Buffer.from(memory.subarray(pointer, end)).toString("latin1");
};
const typeIds = (count, address) =>
  Array.from(
    new Uint32Array(memoryBytes().slice(address, address + count * 4).buffer),
  );
const recorders = {
  __embind_register_class: (a) => ({
    rawType: a[0],
    pointer: a[1],
    constPointer: a[2],
    base: a[3],
    name: cString(a[10]),
    destructorIndex: a[12],
  }),
  __embind_register_class_constructor: (a) => ({
    rawClass: a[0],
    args: typeIds(a[1], a[2]),
    signature: cString(a[3]),
  }),
  __embind_register_class_function: (a) => ({
    rawClass: a[0],
    name: cString(a[1]),
    args: typeIds(a[2], a[3]),
    signature: cString(a[4]),
    pureVirtual: a[7],
  }),
  __embind_register_class_class_function: (a) => ({
    rawClass: a[0],
    name: cString(a[1]),
    args: typeIds(a[2], a[3]),
    signature: cString(a[4]),
  }),
  __embind_register_enum: (a) => ({
    rawType: a[0],
    name: cString(a[1]),
    size: a[2],
    signed: a[3],
  }),
  __embind_register_enum_value: (a) => ({
    rawEnum: a[0],
    name: cString(a[1]),
    value: a[2],
  }),
  __embind_register_void: (a) => ({ rawType: a[0], name: cString(a[1]) }),
  __embind_register_bool: (a) => ({
    rawType: a[0],
    name: cString(a[1]),
    size: a[2],
  }),
  __embind_register_integer: (a) => ({
    rawType: a[0],
    name: cString(a[1]),
    size: a[2],
    min: a[3],
    max: a[4],
  }),
  __embind_register_bigint: (a) => ({
    rawType: a[0],
    name: cString(a[1]),
    size: a[2],
  }),
  __embind_register_float: (a) => ({
    rawType: a[0],
    name: cString(a[1]),
    size: a[2],
  }),
  __embind_register_std_string: (a) => ({ rawType: a[0], name: cString(a[1]) }),
  __embind_register_std_wstring: (a) => ({
    rawType: a[0],
    charSize: a[1],
    name: cString(a[2]),
  }),
  __embind_register_emval: (a) => ({ rawType: a[0], name: cString(a[1]) }),
  __embind_register_memory_view: (a) => ({
    rawType: a[0],
    dataType: a[1],
    name: cString(a[2]),
  }),
};

globalThis.__dirname = directory;
globalThis.require = createRequire(
  pathToFileURL(resolve(directory, "cadara-occ.js")),
);
const { default: init } = await import(
  pathToFileURL(resolve(directory, "cadara-occ.js")).href
);
const unknownRegistrations = new Set();
const oc = await init({
  instantiateWasm(info, receive) {
    const imports = Object.values(info)[0];
    for (const [key, fn] of Object.entries(imports)) {
      if (typeof fn !== "function" || !fn.name.startsWith("__embind_register_"))
        continue;
      const record = recorders[fn.name];
      if (!record) {
        unknownRegistrations.add(fn.name);
        continue;
      }
      imports[key] = (...args) => {
        registrations.push({
          kind: fn.name.slice("__embind_register_".length),
          ...record(args),
        });
        return fn(...args);
      };
    }
    WebAssembly.instantiate(wasmBytes, info).then(({ instance, module }) => {
      wasmExports = instance.exports;
      receive(instance, module);
    });
    return {};
  },
});
const table = Object.values(wasmExports).find(
  (value) => value instanceof WebAssembly.Table,
);

const cases = [];
const run = (name, body) => {
  const entry = { name, status: "running" };
  cases.push(entry);
  try {
    body(entry);
    entry.status = "pass";
  } catch (error) {
    entry.status = "error";
    entry.error = String(error?.stack ?? error);
  }
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// ---- registry: destructor classification and address-independent ABI ----
const typeName = new Map();
for (const r of registrations) {
  if (r.kind === "class") {
    typeName.set(r.rawType, r.name);
    typeName.set(r.pointer, `${r.name}*`);
    typeName.set(r.constPointer, `const ${r.name}*`);
  } else if ("rawType" in r) typeName.set(r.rawType, r.name);
}
// Referenced-but-unbound types are named by their std::type_info mangled name
// (wasm32 libc++ layout: vtable pointer, then name pointer), not by address.
const named = (id) =>
  typeName.get(id) ??
  `?unbound:${cString(new Uint32Array(memoryBytes().slice(id + 4, id + 8).buffer)[0])}`;
const classes = registrations.filter((r) => r.kind === "class");
const destructorRows = classes.map((r) => {
  const fn = wasm.elementToFunction.get(r.destructorIndex);
  const body = wasm.bodies[fn - wasm.importedFunctions];
  const bodyHex = Buffer.from(body.subarray(0, 24)).toString("hex");
  return {
    name: r.name,
    functionIndex: fn,
    tableEntryMatches: table.get(r.destructorIndex).name === String(fn),
    nop: bodyHex === "00010b" || bodyHex === "000b",
  };
});
const abiLines = [];
for (const r of registrations) {
  const args = r.args?.map(named).join(", ");
  if (r.kind === "class")
    abiLines.push(`class ${r.name} base=${r.base ? named(r.base) : "-"}`);
  else if (r.kind === "class_constructor")
    abiLines.push(`ctor ${named(r.rawClass)}(${args}) ${r.signature}`);
  else if (r.kind === "class_function")
    abiLines.push(
      `method ${named(r.rawClass)}.${r.name}(${args}) ${r.signature} pure=${r.pureVirtual}`,
    );
  else if (r.kind === "class_class_function")
    abiLines.push(
      `static ${named(r.rawClass)}.${r.name}(${args}) ${r.signature}`,
    );
  else if (r.kind === "enum")
    abiLines.push(`enum ${r.name} size=${r.size} signed=${r.signed}`);
  else if (r.kind === "enum_value")
    abiLines.push(`enumValue ${named(r.rawEnum)}.${r.name}=${r.value}`);
  else
    abiLines.push(
      `${r.kind} ${r.name} ${JSON.stringify({ ...r, kind: undefined, rawType: undefined, name: undefined })}`,
    );
}
abiLines.sort();
const abiSha256 = sha256(abiLines.join("\n") + "\n");
// Non-constructor bindings returning T* hand JS a borrowed alias of a native owner.
const borrowedPointerReturns = registrations
  .filter(
    (r) =>
      (r.kind === "class_function" || r.kind === "class_class_function") &&
      named(r.args[0]).endsWith("*"),
  )
  .map((r) => ({
    binding: `${named(r.rawClass)}.${r.name}`,
    returns: named(r.args[0])
      .replace(/^const /, "")
      .replace(/\*$/, ""),
  }));
const borrowedPointerClasses = [
  ...new Set(borrowedPointerReturns.map((r) => r.returns)),
].sort();
// A T* return whose pointee class is not bound is named by its mangled
// std::type_info ("P...") and is invisible to the class filter above.
const unboundPointerReturns = registrations
  .filter(
    (r) =>
      (r.kind === "class_function" || r.kind === "class_class_function") &&
      named(r.args[0]).startsWith("?unbound:P"),
  )
  .map((r) => `${named(r.rawClass)}.${r.name}`)
  .sort();

run("registry-nop-destructors-are-only-nonpublic-allowlist", (out) => {
  out.registeredClasses = destructorRows.length;
  out.nop = destructorRows
    .filter((row) => row.nop)
    .map((row) => row.name)
    .sort();
  assert(
    unknownRegistrations.size === 0,
    `Unrecorded embind registrations: ${[...unknownRegistrations]}`,
  );
  assert(
    destructorRows.every((row) => row.tableEntryMatches),
    "Destructor table entries must match parsed element segments",
  );
  assert(
    JSON.stringify(out.nop) === JSON.stringify(NONPUBLIC_DESTRUCTOR_ALLOWLIST),
    `No-op destructors must be exactly ${NONPUBLIC_DESTRUCTOR_ALLOWLIST}`,
  );
  const byName = new Map(destructorRows.map((row) => [row.name, row]));
  const missing = REPAIRED_PLACEMENT_DELETE_CLASSES.filter(
    (name) => !byName.has(name),
  );
  assert(
    missing.length === 0,
    `Repaired classes must stay registered: ${missing}`,
  );
});

run("registry-abi-and-declarations-unchanged", (out) => {
  out.abiEntries = abiLines.length;
  out.abiSha256 = abiSha256;
  out.expectedAbiSha256 = EXPECTED_ABI_SHA256;
  out.dtsSha256 = assets["cadara-occ.d.ts"].sha256;
  assert(
    out.dtsSha256 === EXPECTED_DTS_SHA256,
    "cadara-occ.d.ts must be byte-identical to v8",
  );
  assert(
    abiSha256 === EXPECTED_ABI_SHA256,
    "Embind registry ABI must equal the v8 reference",
  );
});

// Audited inventory: every binding returning T* yields a borrowed alias that must
// never be deleted. Only Standard_Transient.This() returns a repaired class; it
// has no production caller. Any new borrowed return must be audited first.
const AUDITED_BORROWED_POINTER_CLASSES = [
  "BRepTools_History",
  "Geom2d_Curve",
  "Geom_Curve",
  "Poly_Polygon3D",
  "Poly_PolygonOnTriangulation",
  "Poly_Triangulation",
  "Standard_Transient",
  "TopTools_ListOfShape",
];
// Exact binding inventory mirrored by test/static/occ-borrowed-pointer-guard.spec.ts.
const AUDITED_BORROWED_POINTER_BINDINGS = [
  "Handle_BRepTools_History.get",
  "Handle_Geom2d_Curve.get",
  "Handle_Geom_Curve.get",
  "Handle_Poly_Polygon3D.get",
  "Handle_Poly_PolygonOnTriangulation.get",
  "Handle_Poly_Triangulation.get",
  "Standard_Transient.This",
  "TopTools_IndexedDataMapOfShapeListOfShape.ChangeSeek",
  "TopTools_IndexedDataMapOfShapeListOfShape.Seek",
];
// Registered T* returns of unbound pointee types (mangled names). Only
// Handle_TNaming_NamedShape.get is on a production-used class; it is pinned
// uncallable below. The others are recorded as registry presence only.
const AUDITED_UNBOUND_POINTER_BINDINGS = [
  "BRepAlgoAPI_BuilderAlgo.Builder",
  "BRepAlgoAPI_BuilderAlgo.DSFiller",
  "BRepPrimAPI_MakeCylinder.OneAxis",
  "BRepPrimAPI_MakeOneAxis.OneAxis",
  "CDM_Document.Comment",
  "Geom2d_BezierCurve.Weights_2",
  "Geom_BezierCurve.Weights_2",
  "Handle_TNaming_NamedShape.get",
  "TCollection_ExtendedString.ToExtString",
];
run("borrowed-raw-pointer-returns-match-audited-inventory", (out) => {
  out.borrowedPointerReturns = borrowedPointerReturns
    .map((r) => `${r.binding} -> ${r.returns}*`)
    .sort();
  out.unboundPointerReturns = unboundPointerReturns;
  assert(
    JSON.stringify(borrowedPointerReturns.map((r) => r.binding).sort()) ===
      JSON.stringify(AUDITED_BORROWED_POINTER_BINDINGS),
    `Borrowed T* return bindings changed: ${out.borrowedPointerReturns}`,
  );
  assert(
    JSON.stringify(unboundPointerReturns) ===
      JSON.stringify(AUDITED_UNBOUND_POINTER_BINDINGS),
    `Unbound T* return bindings changed: ${unboundPointerReturns}`,
  );
  // Registry presence is not callability: embind installs a JS stub that throws
  // UnboundTypeError before any native call for an unbound return type.
  const d = new oc.TDocStd_Document(
      new oc.TCollection_ExtendedString_2("CadaraLifetime", true),
    ),
    m = d.Main(),
    l = m.NewChild(),
    b = new oc.TNaming_Builder(l),
    maker = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3),
    shape = maker.Shape();
  b.Generated_1(shape);
  const handle = b.NamedShape();
  b.delete();
  out.namedShapeGet = { registered: typeof handle.get === "function" };
  try {
    handle.get();
    out.namedShapeGet.callable = true;
  } catch (error) {
    out.namedShapeGet.callable = false;
    out.namedShapeGet.errorName = error?.name;
  }
  handle.delete();
  l.delete();
  m.delete();
  d.delete();
  shape.delete();
  maker.delete();
  assert(
    out.namedShapeGet.registered &&
      !out.namedShapeGet.callable &&
      out.namedShapeGet.errorName === "UnboundTypeError",
    "Handle_TNaming_NamedShape.get must stay registered but uncallable (UnboundTypeError)",
  );
  const repaired = new Set(REPAIRED_PLACEMENT_DELETE_CLASSES);
  out.repairedClassReturns = borrowedPointerReturns
    .filter((r) => repaired.has(r.returns))
    .map((r) => r.binding)
    .sort();
  assert(
    JSON.stringify(borrowedPointerClasses) ===
      JSON.stringify(AUDITED_BORROWED_POINTER_CLASSES),
    `Borrowed T* return classes changed: ${borrowedPointerClasses}`,
  );
  assert(
    JSON.stringify(out.repairedClassReturns) ===
      JSON.stringify(["Standard_Transient.This"]),
    `Only Standard_Transient.This may return a repaired class by pointer: ${out.repairedClassReturns}`,
  );
});

// ---- native allocation evidence ----
// used(): capacity minus bytes malloc can still hand out below capacity. It is
// deterministic, but each sample is quantized to about 1 MiB, so every slope
// must satisfy reps * resolution >> quantum; resolution is reported per case.
const QUANTUM = 1 << 20;
function used() {
  const capacity = oc.HEAPU8.buffer.byteLength;
  const pointers = [];
  let free = 0;
  for (const chunk of [1 << 20, 1 << 16, 1 << 12, 512, 64, 24, 8])
    for (;;) {
      // Unsigned: above 2 GiB embind/malloc pointers are negative i32 values.
      const pointer = oc._malloc(chunk) >>> 0;
      if (!pointer) break;
      pointers.push(pointer);
      if (pointer + chunk > capacity) break;
      free += chunk;
    }
  for (const pointer of pointers) oc._free(pointer);
  return capacity - free;
}
function slope(fn, reps) {
  for (let i = 0; i < 5; i++) fn(i);
  const before = used();
  for (let i = 0; i < reps; i++) fn(i);
  return (used() - before) / reps;
}
// Overwrite recently freed chunks before checking a sibling, so an erroneous
// free cannot pass by reading stale-but-intact bytes.
function churn(body) {
  const pointers = [];
  for (let i = 0; i < 4096; i++) {
    const size = 8 << (i % 7);
    const pointer = oc._malloc(size) >>> 0;
    oc.HEAPU8.fill(0xa5, pointer, pointer + size);
    pointers.push(pointer);
  }
  try {
    return body();
  } finally {
    for (const pointer of pointers) oc._free(pointer);
  }
}

function meshedBox(i = 0) {
  const builder = new oc.BRepPrimAPI_MakeBox_2(1 + i * 1e-6, 2, 3);
  const shape = builder.Shape();
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.01, false, 0.5, false).delete();
  builder.delete();
  return shape;
}
const document = () =>
  new oc.TDocStd_Document(
    new oc.TCollection_ExtendedString_2("CadaraLifetime", true),
  );

run("metric-quantization-and-sensitivity", (out) => {
  const first = used(),
    second = used();
  const held = Array.from({ length: 1000 }, () => oc._malloc(1000));
  const holding = used();
  for (const pointer of held) oc._free(pointer);
  out.repeatability = second - first;
  out.heldMillionBytes = holding - first;
  out.quantumBytes = QUANTUM;
  assert(out.repeatability === 0, "used() must be repeatable");
  assert(
    out.heldMillionBytes >= 1_000_000 - QUANTUM &&
      out.heldMillionBytes <= 1_000_000 + 2 * QUANTUM,
    "used() must observe held allocations within one quantum",
  );
});

// Each wrapper allocation is fresh per call; if delete() frees it, a second
// batch of the same allocation reuses those chunks. A no-op destructor never does.
const edge = new oc.BRepBuilderAPI_MakeEdge_3(
  new oc.gp_Pnt_3(0, 0, 0),
  new oc.gp_Pnt_3(1, 0, 0),
);
const curve = new oc.BRepAdaptor_Curve_2(edge.Edge());
const box = meshedBox();
const faces = new oc.TopTools_IndexedMapOfShape_1();
oc.TopExp.MapShapes_1(box, oc.TopAbs_ShapeEnum.TopAbs_FACE, faces);
const vertices = new oc.TopTools_IndexedMapOfShape_1();
oc.TopExp.MapShapes_1(box, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, vertices);
const faceKey = faces.FindKey(1);
const face = oc.TopoDS.Face_1(faceKey);
const vertex = oc.TopoDS.Vertex_1(vertices.FindKey(1));
const surface = new oc.BRepAdaptor_Surface_2(face, true);
const plane = surface.Plane();
const axis = plane.Position();
const location = new oc.TopLoc_Location_1();
const boxBuilder = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3);
const doc = document();
const root = doc.Main();
const reuseCases = {
  "control gp_Pnt_3 constructor": () => new oc.gp_Pnt_3(1, 2, 3),
  "gp_Pnt <- BRepAdaptor_Curve.Value": () => curve.Value(0.5),
  "gp_Trsf <- TopLoc_Location.Transformation": () => location.Transformation(),
  "gp_Pln <- BRepAdaptor_Surface.Plane": () => surface.Plane(),
  "gp_Ax3 <- gp_Pln.Position": () => plane.Position(),
  "gp_Pnt <- gp_Pln.Location": () => plane.Location(),
  "gp_Dir <- gp_Ax3.Direction": () => axis.Direction(),
  "gp_Pnt <- BRep_Tool.Pnt": () => oc.BRep_Tool.Pnt(vertex),
  "TopoDS_Shape <- BRepPrimAPI_MakeBox.Shape": () => boxBuilder.Shape(),
  "TopoDS_Shape <- IndexedMap.FindKey": () => faces.FindKey(1),
  "TopoDS_Face <- TopoDS.Face_1": () => oc.TopoDS.Face_1(faceKey),
  "TDF_Label <- TDocStd_Document.Main": () => doc.Main(),
  "TDF_Label <- TDF_Label.NewChild": () => root.NewChild(),
  "new TNaming_Builder": () => new oc.TNaming_Builder(root),
  // BRepCheck_Analyzer is covered by its byte slope below: freeing its large
  // internal maps coalesces chunks, so its own address is not reused verbatim.
  "new TopoDS_Compound": () => new oc.TopoDS_Compound(),
  "new BRep_Builder": () => new oc.BRep_Builder(),
};
run("deleted-wrapper-allocations-are-returned-to-malloc", (out) => {
  const K = 64;
  out.reusedOf64 = {};
  for (const [name, make] of Object.entries(reuseCases)) {
    const first = Array.from({ length: K }, make);
    const freed = new Set(first.map((wrapper) => wrapper.$$.ptr));
    for (const wrapper of first) wrapper.delete();
    const second = Array.from({ length: K }, make);
    out.reusedOf64[name] = second.filter((wrapper) =>
      freed.has(wrapper.$$.ptr),
    ).length;
    for (const wrapper of second) wrapper.delete();
  }
  const notFreed = Object.entries(out.reusedOf64).filter(
    ([, reused]) => reused < K / 2,
  );
  assert(
    notFreed.length === 0,
    `delete() must free native wrapper storage: ${JSON.stringify(notFreed)}`,
  );
});

// Each case: the deleted variant must be flat while the undeleted sensitivity
// control proves the same loop and rep count can see the retained allocation.
const slopeCases = [
  {
    name: "gp_Pnt by-value return",
    reps: 1_000_000,
    deleted: () => curve.Value(0.5).delete(),
    retained: (i, keep) => keep.push(curve.Value(0.5)),
  },
  {
    name: "gp_Trsf by-value return",
    reps: 200_000,
    deleted: () => location.Transformation().delete(),
    retained: (i, keep) => keep.push(location.Transformation()),
  },
  {
    name: "meshed box TopoDS_Shape delete without Nullify",
    reps: 2_000,
    deleted: (i) => meshedBox(i).delete(),
    retained: (i, keep) => keep.push(meshedBox(i)),
  },
  {
    name: "BRepCheck_Analyzer",
    reps: 400,
    deleted: (i) => {
      const s = meshedBox(i);
      const a = new oc.BRepCheck_Analyzer(s, true, false);
      a.IsValid_2();
      a.delete();
      s.delete();
    },
    retained: (i, keep) => {
      const s = meshedBox(i);
      const a = new oc.BRepCheck_Analyzer(s, true, false);
      a.IsValid_2();
      keep.push(a);
      s.delete();
    },
  },
  {
    name: "TopoDS_Compound via BRep_Builder without Nullify",
    reps: 2_000,
    deleted: (i) => {
      const s = meshedBox(i);
      const b = new oc.BRep_Builder();
      const c = new oc.TopoDS_Compound();
      b.MakeCompound(c);
      b.Add(c, s);
      s.delete();
      c.delete();
      b.delete();
    },
    retained: (i, keep) => {
      const s = meshedBox(i);
      const b = new oc.BRep_Builder();
      const c = new oc.TopoDS_Compound();
      b.MakeCompound(c);
      b.Add(c, s);
      s.delete();
      keep.push(c);
      b.delete();
    },
  },
  {
    // Builders must be deleted BEFORE their document: with real destructors a
    // builder outliving its document is a use-after-free (observed abort).
    name: "TNaming_Builder retention past document deletion",
    reps: 2_000,
    deleted: (i) => {
      const s = meshedBox(i);
      const d = document();
      const m = d.Main();
      const l = m.NewChild();
      const nb = new oc.TNaming_Builder(l);
      nb.Generated_1(s);
      nb.delete();
      l.delete();
      m.delete();
      d.delete();
      s.delete();
    },
    retained: (i, keep) => {
      const s = meshedBox(i);
      const d = document();
      const m = d.Main();
      const l = m.NewChild();
      const nb = new oc.TNaming_Builder(l);
      nb.Generated_1(s);
      // Cleanup deletes in push order: builder first, then its document.
      keep.push(nb, d);
      l.delete();
      m.delete();
      s.delete();
    },
  },
  {
    // Safe release order for every production-used TNaming wrapper: builders and
    // selectors, then TDF-attribute handles, then labels, then the document.
    // Nothing is leaked or retained to pin the attribute.
    name: "TNaming builders, selectors and attribute handles before document",
    reps: 2_000,
    deleted: (i) => {
      const n = namingAttributeWrappers(i);
      n.builder.delete();
      n.selector.delete();
      if (i % 250 === 0) assertNamingWrappersValid(n);
      for (const handle of [n.named, n.selected, n.current]) handle.delete();
      n.valid.delete();
      if (i % 250 === 0)
        assert(
          churn(() => n.main.NbChildren() === 2),
          "Document must stay valid after its attribute handles are released",
        );
      for (const label of [n.label, n.selectorLabel, n.main]) label.delete();
      n.document.delete();
      n.shape.delete();
    },
    retained: (i, keep) => {
      const n = namingAttributeWrappers(i);
      // Cleanup deletes in push order, which is the same safe order.
      keep.push(
        n.builder,
        n.selector,
        n.named,
        n.selected,
        n.current,
        n.valid,
        n.label,
        n.selectorLabel,
        n.main,
        n.document,
      );
      n.shape.delete();
    },
  },
];
function namingAttributeWrappers(i) {
  const shape = meshedBox(i);
  const document_ = document();
  const main = document_.Main();
  const label = main.NewChild();
  const selectorLabel = main.NewChild();
  const builder = new oc.TNaming_Builder(label);
  builder.Generated_1(shape);
  const named = builder.NamedShape();
  const selector = new oc.TNaming_Selector(selectorLabel);
  selector.Select_2(shape, false, true);
  const selected = selector.NamedShape();
  const valid = new oc.TDF_LabelMap_1();
  valid.Add(label);
  valid.Add(selectorLabel);
  const current = oc.TNaming_Tool.CurrentNamedShape_1(selected, valid);
  return {
    shape,
    document: document_,
    main,
    label,
    selectorLabel,
    builder,
    named,
    selector,
    selected,
    valid,
    current,
  };
}
// Attribute handles and label copies must stay usable after the producers are
// freed and their chunks overwritten, while the document is still alive.
function assertNamingWrappersValid(n) {
  const ok = churn(() =>
    [n.named, n.selected, n.current].every((handle) => {
      if (handle.IsNull()) return false;
      const shape = oc.TNaming_Tool.GetShape(handle);
      const same = shape.IsSame(n.shape);
      shape.delete();
      return same;
    }),
  );
  assert(
    ok && n.main.NbChildren() === 2,
    "Attribute handles must stay valid after builder/selector release",
  );
}
for (const entry of slopeCases) {
  run(`slope: ${entry.name}`, (out) => {
    out.reps = entry.reps;
    out.resolutionBytesPerRep = (2 * QUANTUM) / entry.reps;
    out.deletedBytesPerRep = slope(entry.deleted, entry.reps);
    const keep = [];
    out.retainedControlBytesPerRep = slope(
      (i) => entry.retained(i, keep),
      entry.reps,
    );
    for (const wrapper of keep) wrapper.delete();
    out.heapCapacityBytes = oc.HEAPU8.buffer.byteLength;
    assert(
      out.retainedControlBytesPerRep >= 8 * out.resolutionBytesPerRep,
      "Sensitivity control must exceed 8x the metric resolution",
    );
    assert(
      out.deletedBytesPerRep <=
        Math.max(
          out.resolutionBytesPerRep,
          0.05 * out.retainedControlBytesPerRep,
        ),
      "Deleted wrappers must not retain native memory",
    );
  });
}

// ---- copies and borrowed aliases after real frees ----
run("sibling-copies-stay-valid-after-other-copy-delete", (entry) => {
  const out = (entry.checks = {});
  const shape = meshedBox(7);
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
  const k1 = map.FindKey(1),
    k2 = map.FindKey(1);
  k1.delete();
  out.findKey = churn(() => {
    const again = map.FindKey(1);
    const same = !k2.IsNull() && k2.IsSame(again);
    again.delete();
    return same && map.Extent() === 6;
  });
  const f = oc.TopoDS.Face_1(k2);
  f.delete();
  out.face1 = churn(
    () => !k2.IsNull() && k2.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_FACE,
  );
  const maker = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3);
  const s1 = maker.Shape(),
    s2 = maker.Shape();
  s1.delete();
  out.makeShape = churn(() => {
    const again = maker.Shape();
    const same = s2.IsSame(again);
    again.delete();
    return same;
  });
  const clone = s2.clone();
  clone.delete();
  out.clone = churn(
    () =>
      !s2.isDeleted() &&
      !s2.IsNull() &&
      s2.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_SOLID,
  );
  s2.delete();
  out.makeShapeAfterAllCopiesDeleted = churn(() => {
    const again = maker.Shape();
    const ok = !again.IsNull();
    again.delete();
    return ok;
  });
  const d = document();
  const main1 = d.Main(),
    main2 = d.Main();
  const child = main1.NewChild();
  const builder = new oc.TNaming_Builder(child);
  builder.Generated_1(k2);
  const named = builder.NamedShape();
  builder.delete();
  child.delete();
  main1.delete();
  out.labelsAndNaming = churn(() => {
    const current = oc.TNaming_Tool.GetShape(named);
    const ok =
      !main2.IsNull() && main2.NbChildren() === 1 && current.IsSame(k2);
    current.delete();
    return ok;
  });
  named.delete();
  main2.delete();
  d.delete();
  for (const value of [k2, map, maker, shape]) value.delete();
  assert(
    Object.values(out).every((ok) => ok === true),
    "Every copy sibling must remain valid",
  );
});

run("borrowed-get-aliases-are-shared-and-never-deleted", (out) => {
  const shape = meshedBox(9);
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
  const key = map.FindKey(1);
  const f = oc.TopoDS.Face_1(key);
  const loc = new oc.TopLoc_Location_1();
  const handle = oc.BRep_Tool.Triangulation(f, loc, 0);
  // Only the owning handle is deleted; the T* aliases are dropped, never deleted.
  const first = handle.get(),
    second = handle.get();
  out.sameAliasPointer = first.$$.ptr === second.$$.ptr;
  out.aliasClassRealDestructor = !destructorRows.find(
    (row) => row.name === first.$$.ptrType.registeredClass.name,
  )?.nop;
  const nodes = first.NbNodes();
  const copy = oc.BRep_Tool.Triangulation(f, loc, 0);
  copy.delete();
  out.ownerSurvivesHandleCopyDelete = churn(
    () => handle.get().NbNodes() === nodes && nodes > 0,
  );
  for (const value of [handle, loc, f, key, map, shape]) value.delete();
  assert(
    out.sameAliasPointer &&
      out.aliasClassRealDestructor &&
      out.ownerSurvivesHandleCopyDelete,
    "Borrowed aliases must stay shared and owner-backed",
  );
});

// ---- release-order hazard witness, isolated in child runtimes ----
// With real TNaming_Builder destructors a Handle_TNaming_NamedShape can be the
// last owner of its attribute; releasing it after the document runs its
// destructor on freed OCAF state. The unsafe order runs only in a separate
// process so its trap cannot corrupt this runtime. A trap at the attribute
// handle delete with an out-of-bounds message is evidence only; completing is
// not proof of safety (no UAF detector here).
const RELEASE_ORDER_CHILD = `
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const [directory, order] = process.argv.slice(1);
const js = resolve(directory, "cadara-occ.js");
const wasmBinary = readFileSync(resolve(directory, "cadara-occ.wasm"));
const out = { order, wasmSha256: createHash("sha256").update(wasmBinary).digest("hex") };
globalThis.__dirname = directory;
globalThis.require = createRequire(pathToFileURL(js));
const oc = await (await import(pathToFileURL(js).href)).default({ wasmBinary });
const churn = () => {
  const pointers = [];
  for (let i = 0; i < 4096; i++) {
    const size = 8 << (i % 7), pointer = oc._malloc(size) >>> 0;
    oc.HEAPU8.fill(0xa5, pointer, pointer + size);
    pointers.push(pointer);
  }
  for (const pointer of pointers) oc._free(pointer);
};
const maker = new oc.BRepPrimAPI_MakeBox_2(1, 2, 3);
const shape = maker.Shape();
try {
  for (out.iterations = 0; out.iterations < 20; out.iterations++) {
    const d = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_2("CadaraLifetime", true));
    const m = d.Main(), l = m.NewChild();
    const builder = new oc.TNaming_Builder(l);
    builder.Generated_1(shape);
    const named = builder.NamedShape();
    builder.delete();
    if (order === "handle-before-document") named.delete();
    out.activeOperation = "labels"; l.delete(); m.delete();
    out.activeOperation = "document"; d.delete();
    out.activeOperation = "churn-after-document"; churn();
    out.activeOperation = "attribute-handle-delete";
    if (order === "handle-after-document") named.delete();
    out.activeOperation = "final-churn"; churn();
  }
  out.status = "completed";
} catch (error) {
  out.status = "threw";
  out.errorName = error?.name;
  out.error = String(error?.message ?? error).slice(0, 200);
} finally {
  shape.delete();
  maker.delete();
}
console.log(JSON.stringify(out));
`;
function releaseOrderChild(order) {
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", RELEASE_ORDER_CHILD, directory, order],
    { encoding: "utf8", timeout: 120_000 },
  );
  const line = child.stdout.trim().split("\n").at(-1);
  let report = null;
  try {
    report = JSON.parse(line);
  } catch {
    report = { unparsedStdout: line ?? "" };
  }
  return {
    exitCode: child.status,
    signal: child.signal,
    stderr: child.stderr.slice(-400),
    ...report,
  };
}
run("attribute-handle-after-document-is-unsafe-release-order", (out) => {
  out.safe = releaseOrderChild("handle-before-document");
  out.unsafe = releaseOrderChild("handle-after-document");
  const expectedWasm = assets["cadara-occ.wasm"].sha256;
  assert(
    out.safe.wasmSha256 === expectedWasm &&
      out.unsafe.wasmSha256 === expectedWasm,
    "Release-order children must load the staged wasm under test",
  );
  assert(
    out.safe.exitCode === 0 &&
      out.safe.status === "completed" &&
      out.safe.iterations === 20,
    "Builder then NamedShape handle before document must complete",
  );
  out.unsafeTrapped =
    out.unsafe.status === "threw" &&
    out.unsafe.errorName === "RuntimeError" &&
    out.unsafe.activeOperation === "attribute-handle-delete" &&
    /memory access out of bounds/i.test(out.unsafe.error ?? "");
  assert(
    out.unsafeTrapped,
    "Hazard witness: a NamedShape handle released after its document (builder already freed) must trap at attribute-handle-delete with RuntimeError: memory access out of bounds; otherwise re-audit before relaxing the release order",
  );
});

for (const value of [
  doc,
  root,
  boxBuilder,
  location,
  axis,
  plane,
  surface,
  vertex,
  face,
  faceKey,
  vertices,
  faces,
  box,
  curve,
  edge,
])
  value.delete();

const result = {
  runtime: process.version,
  directory,
  assets,
  cases,
  summary: {
    pass: cases.filter((entry) => entry.status === "pass").length,
    error: cases.filter((entry) => entry.status === "error").length,
  },
};
if (process.argv[3]) {
  writeFileSync(
    resolve(process.argv[3]),
    JSON.stringify(result, null, 2) + "\n",
  );
  writeFileSync(
    resolve(process.argv[3]).replace(/\.json$/, "") + ".abi.txt",
    abiLines.join("\n") + "\n",
  );
}
console.log(JSON.stringify(result));
if (result.summary.error) process.exitCode = 1;

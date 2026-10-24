import { readFile } from "node:fs/promises";
import { beforeAll, expect, test } from "vitest";

import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  OccShapeSetCheckpointInvalidError,
  OccShapeSetCheckpointWriteError,
  readOccShapeSetCheckpoint,
  writeOccShapeSetCheckpoint,
} from "@/domain/modeling/occ/shape-set-checkpoint";

type OccShape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
type Wrapper = { delete(): void; isDeleted(): boolean };

// The production kernel build: the shim exists only there, not in stock opencascade.js.
let oc: OpenCascadeInstance;
beforeAll(async () => {
  const module =
    (await import("../../../../public/cadara-occ.js")) as unknown as {
      default: new (
        settings: Record<string, unknown>,
      ) => Promise<OpenCascadeInstance>;
    };
  const wasmBinary = new Uint8Array(
    await readFile(
      new URL("../../../../public/cadara-occ.wasm", import.meta.url),
    ),
  );
  oc = await new module.default({ wasmBinary });
});

const owned: Wrapper[] = [];
/** Every embind wrapper exposes delete()/isDeleted(); the stock typings omit some. */
function own<T>(value: T): T {
  owned.push(value as unknown as Wrapper);
  return value;
}

/** The brep-precision.mjs box: most coordinates need 16-17 significant digits. */
function awkwardBox() {
  const origin = own(new oc.gp_Pnt_3(1 / 3, Math.PI, 1e-7 / 3));
  return own(
    own(new oc.BRepPrimAPI_MakeBox_3(origin, 2 / 3, Math.E, 0.1)).Shape(),
  );
}

function rotated(shape: OccShape) {
  const trsf = own(new oc.gp_Trsf_1());
  const axis = own(
    new oc.gp_Ax1_2(own(new oc.gp_Pnt_1()), own(new oc.gp_Dir_4(0, 0, 1))),
  );
  trsf.SetRotation_1(axis, 1.234567);
  return own(shape.Located(own(new oc.TopLoc_Location_2(trsf)), false));
}

function vertexCoordinates(shape: OccShape) {
  const coordinates: number[] = [];
  const explorer = own(
    new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    ),
  );
  for (; explorer.More(); explorer.Next()) {
    const vertex = own(oc.TopoDS.Vertex_1(own(explorer.Current())));
    const point = own(oc.BRep_Tool.Pnt(vertex));
    coordinates.push(point.X(), point.Y(), point.Z());
  }
  return coordinates;
}

function locationValues(shape: OccShape) {
  const trsf = own(own(shape.Location_1()).Transformation());
  return [
    ...[1, 2, 3].flatMap((row) =>
      [1, 2, 3, 4].map((column) => trsf.Value(row, column)),
    ),
    trsf.ScaleFactor(),
  ];
}

/** Indexes whose values are not the same IEEE-754 double. */
function changed(before: number[], after: number[]) {
  expect(after).toHaveLength(before.length);
  return before.flatMap((value, index) =>
    Object.is(value, after[index]) ? [] : [index],
  );
}

function release() {
  for (const wrapper of owned.splice(0).reverse()) {
    if (!wrapper.isDeleted()) wrapper.delete();
  }
}

test("unlocated and located boxes come back bit-exact, in order and shared", () => {
  try {
    const unlocated = awkwardBox();
    const located = rotated(awkwardBox());
    const checkpoint = writeOccShapeSetCheckpoint(oc, [
      unlocated,
      located,
      unlocated,
    ]);
    const restored = readOccShapeSetCheckpoint(oc, checkpoint).map((shape) =>
      own(shape),
    );

    expect(restored).toHaveLength(3);
    for (const [index, original] of [unlocated, located].entries()) {
      const coordinates = vertexCoordinates(original);
      expect(coordinates).toHaveLength(144);
      expect(changed(coordinates, vertexCoordinates(restored[index]!))).toEqual(
        [],
      );
      expect(
        changed(locationValues(original), locationValues(restored[index]!)),
      ).toEqual([]);
    }
    expect(restored[0]!.IsEqual(restored[2]!)).toBe(true);
    expect(restored[0]!.IsSame(restored[1]!)).toBe(false);
    expect(writeOccShapeSetCheckpoint(oc, restored)).toBe(checkpoint);
  } finally {
    release();
  }
});

test("a truncated checkpoint throws a structured error and leaves no native result alive", () => {
  const native = (
    oc as unknown as Record<string, { Read: (text: string) => Wrapper }>
  ).CadaraNativeShapeSetCheckpoint!;
  const read = native.Read;
  const results: Wrapper[] = [];
  native.Read = (text) => {
    const result = read(text);
    results.push(result);
    return result;
  };
  try {
    const checkpoint = writeOccShapeSetCheckpoint(oc, [awkwardBox()]);
    expect(() =>
      readOccShapeSetCheckpoint(oc, checkpoint.slice(0, -12)),
    ).toThrow(OccShapeSetCheckpointInvalidError);
    expect(() => readOccShapeSetCheckpoint(oc, "not a checkpoint")).toThrow(
      /occ-shape-set-checkpoint-invalid: not a cadara-native-shape-set\/v1 checkpoint/,
    );
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.isDeleted())).toBe(true);
    expect(() =>
      writeOccShapeSetCheckpoint(oc, [own(new oc.TopoDS_Shape())]),
    ).toThrow(OccShapeSetCheckpointInvalidError);
  } finally {
    native.Read = read;
    release();
  }
});

test("a failed native write throws its cause and releases the native result", () => {
  const native = (
    oc as unknown as Record<string, { Write: (root: OccShape) => Wrapper }>
  ).CadaraNativeShapeSetCheckpoint!;
  const write = native.Write;
  const results: Wrapper[] = [];
  // The real native failure for a null root, in place of an OCCT failure.
  native.Write = () => {
    const result = write(own(new oc.TopoDS_Shape()));
    results.push(result);
    return result;
  };
  try {
    expect(() => writeOccShapeSetCheckpoint(oc, [awkwardBox()])).toThrow(
      new OccShapeSetCheckpointWriteError("root shape is null"),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.isDeleted()).toBe(true);
  } finally {
    native.Write = write;
    release();
  }
});

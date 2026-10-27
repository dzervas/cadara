import { expect, test } from "vitest";
import type { CadaraBrepFaceRecord } from "@/contracts/modeling/geometry-assets";
import type { BodyId, FaceId } from "@/contracts/shared/ids";
import {
  captureSplitInterfaceOwnerWitness,
  selectSplitInterfaceOwner,
} from "./split-interface-owner-witness";
import {
  readRollbackTopologySnapshot,
  type RollbackTopologySnapshot,
} from "../../../core/import/onshape/rollback-topology-reader";
import type { OnshapeRollbackSnapshot } from "@/contracts/import/onshape-capture-bundle";

const vertices: [number, number, number][] = [
  [0, 0, 0],
  [0.01, 0, 0],
  [0, 0.01, 0],
];
const capture = {
  diagnostics: [],
  bodies: [
    {
      id: "source-owner",
      faces: [{ id: "source-face", facets: [{ vertices }] }],
    },
  ],
} as unknown as RollbackTopologySnapshot;
const witness = () =>
  captureSplitInterfaceOwnerWitness(capture, capture, "source-face");
const face = (reversed = false): CadaraBrepFaceRecord => ({
  faceKey: "native-face",
  loopIndices: [],
  surface: {
    kind: "plane",
    frame: { origin: [0, 0, 0], zDirection: [0, 0, 1], xDirection: [1, 0, 0] },
  },
  meshVertices: [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0],
  ],
  triangles: reversed ? [[0, 2, 1]] : [[0, 1, 2]],
});
const candidate = (body: string, reversed = false) => ({
  reference: {
    kind: "face" as const,
    bodyId: body as BodyId,
    faceId: "native-face" as FaceId,
  },
  face: face(reversed),
});

const parsedCapture = (damagedFaceId?: string) =>
  readRollbackTopologySnapshot({
    featureId: "split",
    tessellationTolerance: 0.001,
    tessellatedFaces: {
      bodies: [
        {
          id: "source-owner",
          faces: ["source-face", "other-face"].map((id) => ({
            id,
            facets: [
              { vertices: vertices.map(([x, y, z]) => ({ x, y, z })) },
              ...(damagedFaceId === id ? [{ vertices: [{ x: 0, y: 0 }] }] : []),
            ],
          })),
        },
      ],
    },
  } as OnshapeRollbackSnapshot);

test.each(["producer", "consumer", "both"] as const)(
  "unreadable selected-face facet at %s boundary cannot certify a truncated trim",
  (boundary) => {
    const producer = parsedCapture(
      boundary === "consumer" ? undefined : "source-face",
    );
    const consumer = parsedCapture(
      boundary === "producer" ? undefined : "source-face",
    );
    const damaged = boundary === "consumer" ? consumer : producer;
    expect(damaged.diagnostics).toEqual([
      expect.objectContaining({
        code: "rollback-tessellation-unreadable",
        faceId: "source-face",
      }),
    ]);
    // The reader deliberately preserves the valid triangle: comparing parsed
    // facets alone therefore cannot prove that either full boundary was read.
    expect(producer.bodies[0]!.faces[0]!.facets).toEqual(
      consumer.bodies[0]!.faces[0]!.facets,
    );
    let selected: unknown;
    expect(() => {
      const owner = captureSplitInterfaceOwnerWitness(
        producer,
        consumer,
        "source-face",
      );
      selected = selectSplitInterfaceOwner(owner, [candidate("correct")]);
    }).toThrow();
    expect(selected).toBeUndefined();
  },
);

test("unscoped unreadable source evidence fails closed", () => {
  const complete = parsedCapture();
  const rawBodies = (complete.source.tessellatedFaces as { bodies: unknown[] })
    .bodies;
  const damaged = readRollbackTopologySnapshot({
    ...complete.source,
    tessellatedFaces: { bodies: [...rawBodies, { faces: [] }] },
  });
  expect(damaged.diagnostics).toEqual([
    expect.objectContaining({ code: "rollback-tessellation-unreadable" }),
  ]);
  expect(damaged.diagnostics[0]!.faceId).toBeUndefined();
  expect(() =>
    captureSplitInterfaceOwnerWitness(damaged, complete, "source-face"),
  ).toThrow("unreadable");
  expect(() =>
    captureSplitInterfaceOwnerWitness(complete, damaged, "source-face"),
  ).toThrow("unreadable");
});

test("an identified unreadable other face does not invalidate complete selected-face authority", () => {
  const parsed = parsedCapture("other-face");
  expect(parsed.diagnostics).toEqual([
    expect.objectContaining({
      code: "rollback-tessellation-unreadable",
      faceId: "other-face",
    }),
  ]);
  expect(
    selectSplitInterfaceOwner(
      captureSplitInterfaceOwnerWitness(parsed, parsed, "source-face"),
      [candidate("correct")],
    ),
  ).toEqual(candidate("correct").reference);
});

test("captured owner winding selects one exact occurrence, not the opposite occurrence or list order", () => {
  const owner = witness();
  expect(owner.capturedBodyId).toBe("source-owner");
  expect(owner.orientedNormal).toEqual([0, 0, 1]);
  expect(
    selectSplitInterfaceOwner(owner, [
      candidate("opposite", true),
      candidate("correct"),
    ]),
  ).toEqual(candidate("correct").reference);
  expect(() =>
    selectSplitInterfaceOwner(owner, [candidate("opposite", true)]),
  ).toThrow();
});

test("unknown, missing, inconsistent and duplicate-owner evidence fails closed", () => {
  const owner = witness();
  expect(() =>
    selectSplitInterfaceOwner(undefined, [candidate("correct")]),
  ).toThrow();
  expect(() =>
    selectSplitInterfaceOwner({ ...owner, orientedNormal: [0, 0, -1] }, [
      candidate("correct"),
    ]),
  ).toThrow();
  expect(() =>
    selectSplitInterfaceOwner(owner, [candidate("one"), candidate("two")]),
  ).toThrow();
  const unknown = candidate("unknown");
  unknown.face.triangles = [];
  expect(() => selectSplitInterfaceOwner(owner, [unknown])).toThrow();
  expect(() =>
    selectSplitInterfaceOwner(owner, [candidate("correct"), unknown]),
  ).toThrow();
  const inconsistent = candidate("inconsistent");
  inconsistent.face.triangles.push([0, 2, 1]);
  expect(() => selectSplitInterfaceOwner(owner, [inconsistent])).toThrow();
  expect(() =>
    captureSplitInterfaceOwnerWitness(null, capture, "source-face"),
  ).toThrow();
  expect(() =>
    captureSplitInterfaceOwnerWitness(
      { ...capture, bodies: [...capture.bodies, ...capture.bodies] },
      capture,
      "source-face",
    ),
  ).toThrow();
  const nonplanar = candidate("nonplanar");
  nonplanar.face.surface = { kind: "unsupported", typeName: "unknown" };
  expect(() => selectSplitInterfaceOwner(owner, [nonplanar])).toThrow();
  const differentTrim = candidate("same-box-different-trim");
  differentTrim.face.meshVertices = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
  ];
  differentTrim.face.triangles = [
    [0, 1, 2],
    [0, 2, 3],
  ];
  expect(() => selectSplitInterfaceOwner(owner, [differentTrim])).toThrow();
  const moved = candidate("moved");
  moved.face.meshVertices[0] = [0, 0, 1];
  expect(() => selectSplitInterfaceOwner(owner, [moved])).toThrow();
  const changed = {
    ...capture,
    bodies: [
      {
        id: "source-owner",
        faces: [
          {
            id: "source-face",
            facets: [
              {
                vertices: [[0, 0, 0.001], ...vertices.slice(1)] as [
                  number,
                  number,
                  number,
                ][],
              },
            ],
          },
        ],
      },
    ],
  };
  expect(() =>
    captureSplitInterfaceOwnerWitness(capture, changed, "source-face"),
  ).toThrow();
});

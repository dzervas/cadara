import { expect, test } from "vitest";
import type { CadaraBrepFaceRecord } from "@/contracts/modeling/geometry-assets";
import type { BodyId, FaceId } from "@/contracts/shared/ids";
import {
  captureSplitInterfaceOwnerWitness,
  selectSplitInterfaceOwner,
} from "./split-interface-owner-witness";
import type { RollbackTopologySnapshot } from "./rollback-topology-reader";

const vertices: [number, number, number][] = [
  [0, 0, 0],
  [0.01, 0, 0],
  [0, 0.01, 0],
];
const capture = {
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

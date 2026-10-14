import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("linear derivation copies preserve shared rectangle points and requirement identities", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [2, 2], end: [6, 5] },
      construction: false,
      intent: "fulfill",
    });
    const targets = source
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    const patterned = await w.execute({
      operation: "sketch.derivation.create",
      draft: source.discovery!.state.draft,
      kind: "linearPattern",
      targets: [targets[2], targets[0], targets[3], targets[1]],
      value: 10,
      intent: "fulfill",
    });
    const output =
      patterned.discovery!.sketch!.derivations[0]!.currentGeometry!;
    const corners = output.flatMap((e) => e.points);
    expect(new Set(corners.map((p) => p.pointId)).size).toBe(4);
    expect(
      [...new Set(corners.map((p) => JSON.stringify(p.position)))].sort(),
    ).toEqual(
      [
        [12, 2],
        [12, 5],
        [16, 2],
        [16, 5],
      ]
        .map((p) => JSON.stringify(p))
        .sort(),
    );
    expect(
      patterned.discovery!.sketch!.constraints.map((c) => c.constraintId),
    ).toEqual(source.discovery!.sketch!.constraints.map((c) => c.constraintId));
    expect(patterned.discovery!.sketch!.profiles).toHaveLength(2);
  } finally {
    await w.close();
  }
}, 120_000);

test("derived transforms preserve supported point, line, arc and ordinary spline geometry with no invented closed profiles", async () => {
  for (const [primitive, positions] of [
    [{ kind: "point", position: [4, 3] }, [[14, 3]]],
    [
      { kind: "line", start: [2, 2], end: [6, 5] },
      [
        [12, 2],
        [16, 5],
      ],
    ],
    [
      { kind: "centerPointArc", center: [4, 3], start: [6, 3], end: [4, 5] },
      [
        [16, 3],
        [14, 5],
        [14, 3],
      ],
    ],
    [
      {
        kind: "spline",
        fitPoints: [
          [2, 2],
          [4, 5],
          [8, 2],
        ],
      },
      [
        [12, 2],
        [14, 5],
        [18, 2],
      ],
    ],
  ] as const) {
    const w = await createSketchWorkflow();
    try {
      const source = await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive,
        construction: false,
        intent: "fulfill",
      });
      const seed = source.discovery!.references.find(
        (r) => r.target.kind === "sketchEntity",
      )!.target;
      const transformed = await w.execute({
        operation: "sketch.derivation.create",
        draft: source.discovery!.state.draft,
        kind: "transform",
        targets: [seed],
        value: 10,
        intent: "fulfill",
      });
      expect(
        transformed.discovery!.sketch!.derivations[0]!.currentGeometry![0]!.points.map(
          (p) => p.position,
        ),
      ).toEqual(positions);
      if (primitive.kind === "centerPointArc")
        expect(
          transformed.discovery!.sketch!.derivations[0]!.currentGeometry![0]!
            .radius,
        ).toBe(2);
      expect(transformed.discovery!.sketch!.profiles).toHaveLength(0);
    } finally {
      await w.close();
    }
  }
}, 120_000);

test("invalid settings and unavailable, repeated or unsupported seeds refuse without changing geometry or history", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const seed = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    for (const kind of [
      "linearPattern",
      "circularPattern",
      "transform",
    ] as const) {
      for (const input of [
        { targets: [seed], value: 0 },
        { targets: [seed], value: -1 },
        { targets: [], value: 10 },
        { targets: [seed, seed], value: 10 },
        { targets: [{ ...seed, sketchId: "sketch_foreign" }], value: 10 },
      ]) {
        const refused = await w.run({
          operation: "sketch.derivation.create",
          draft: source.discovery!.state.draft,
          kind,
          intent: "fulfill",
          ...input,
        });
        expect(refused.outcome.kind).toBe("rejected");
        expect(refused.completion.live.kind).toBe("unchanged");
        const inspect = await w.execute({
          operation: "sketch.inspect",
          draft: source.discovery!.state.draft,
        });
        expect(inspect.discovery!.sketch!.entities).toEqual(
          source.discovery!.sketch!.entities,
        );
        expect(inspect.discovery!.history!.undoEntries!).toEqual(
          source.discovery!.history!.undoEntries!,
        );
      }
    }
    const ellipse = await w.execute({
      operation: "sketch.author",
      draft: source.discovery!.state.draft,
      primitive: {
        kind: "ellipse",
        points: [
          [20, 0],
          [25, 0],
          [20, 2],
        ],
      },
      construction: false,
      intent: "author-invalid",
    });
    const unsupportedId = ellipse.discovery!.sketch!.entities.at(-1)!.entityId;
    const unsupported = ellipse.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" && r.target.entityId === unsupportedId,
    )!.target;
    const refused = await w.run({
      operation: "sketch.derivation.create",
      draft: ellipse.discovery!.state.draft,
      kind: "linearPattern",
      targets: [unsupported],
      value: 10,
      intent: "fulfill",
    });
    expect(refused.outcome.kind).toBe("rejected");
    expect(refused.completion.live.kind).toBe("unchanged");
    const stale = await w.run({
      operation: "sketch.derivation.create",
      draft: source.discovery!.state.draft,
      kind: "linearPattern",
      targets: [seed],
      value: 10,
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
  } finally {
    await w.close();
  }
}, 120_000);

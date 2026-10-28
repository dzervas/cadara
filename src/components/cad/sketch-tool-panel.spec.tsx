import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchToolPanel } from "@/components/cad/sketch-tool-panel";
import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
} from "@/components/cad/viewport-overlay-layout";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  finalizeSketchDraw,
  getSketchToolPresentation,
  selectSketchEditToolTarget,
  setSketchInferenceSuppression,
  startSketchDraw,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";
import {
  PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
  SPLINE_SLOT_UNSUPPORTED_MESSAGE,
} from "@/core/sketch-editing/operations";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";

test("src/components/cad/sketch-tool-panel.spec.tsx", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchToolPanel
        schema={{
          prompts: [{ id: "line-prompt", text: "Pick the starting point." }],
        }}
        onPatch={() => undefined}
      />
    </MantineProvider>,
  );

  expect(
    markup.includes("Pick the starting point."),
    "Sketch tool panels should render active tool prompts.",
  ).toBeTruthy();
  expect(
    markup.includes(`left:${VIEWPORT_FLOATING_PANEL_LEFT_PX}px`) &&
      markup.includes(`top:${VIEWPORT_FLOATING_PANEL_TOP_STYLE}`),
    "Sketch tool panels should use the shared floating panel slot instead of rendering under the toolbar and parts tree.",
  ).toBeTruthy();
  expect(
    markup.includes("z-20") &&
      markup.includes("pointer-events-none") &&
      !markup.includes("left-4 top-4"),
    "Sketch tool panels should stay on the workbench overlay layer without anchoring to the blocked toolbar corner.",
  ).toBeTruthy();
  expect(
    markup.includes("pointer-events-auto"),
    "Prompt-only sketch tool panels should not intercept canvas picks while visible in the left editor slot.",
  ).toBeFalsy();
});

// Lane: UI (docs/testing.md). Seam: the panel renders the edit tool's
// validation message from the session's tool presentation (T10h, D6): Slot
// along a spline and the static offset of a projected spline are refused
// with an explicit "not supported yet" message the user sees.
test("the sketch tool panel shows the D6 not-supported-yet messages", () => {
  // A fit-point spline commits when it is finalized (T11i).
  const drawn = finalizeSketchDraw(
    acceptSketchDraw(
      acceptSketchDraw(
        startSketchDraw(
          beginSketchTool(
            withSketchSnapScale(
              enterSketchSession(
                createNewSketchSessionFromSupport(
                  {
                    kind: "construction",
                    constructionId: "construction_plane-xy",
                  },
                  OCC_KERNEL_SETTINGS,
                ),
              ),
              SPEC_SKETCH_UNITS_PER_PIXEL,
            ),
            "spline",
          ),
          [0, 0],
        ),
        [1, 2],
      ),
      [2, 0],
    ),
  );
  const spline = drawn.definition.entities.find(
    (entity) => entity.kind === "spline",
  )!;
  const slot = selectSketchEditToolTarget(
    beginSketchTool(drawn, "sketchSlot"),
    spline.target,
  );
  const offset = selectSketchEditToolTarget(
    beginSketchTool(
      {
        ...drawn,
        projectedReferences: [
          {
            referenceId: "ref_projected_spline",
            status: "projected",
            geometry: [
              {
                geometryId: "projected_geometry_spline",
                kind: "spline",
                representation: {
                  kind: "sourceSamples",
                  points: [
                    [0, 0],
                    [1, 2],
                    [2, 0],
                  ],
                  isClosed: false,
                },
              },
            ],
            diagnostics: [],
          },
        ] as SketchSessionState["projectedReferences"],
      },
      "offset",
    ),
    {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_projected_spline",
      geometryId: "projected_geometry_spline",
      geometryKind: "spline",
    } as never,
  );
  for (const [session, message] of [
    [slot, SPLINE_SLOT_UNSUPPORTED_MESSAGE],
    [offset, PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE],
  ] as const) {
    const markup = renderToStaticMarkup(
      <MantineProvider>
        <SketchToolPanel
          schema={getSketchToolPresentation(session)}
          onPatch={() => undefined}
        />
      </MantineProvider>,
    );
    expect(markup.includes(message), `The panel shows "${message}".`).toBe(
      true,
    );
  }
});

// Lane: UI (docs/testing.md). Seam: the panel renders a Trim click's pending
// state from the session's tool presentation (T10g-1): the edit waits for its
// exact intersections and the user sees that it is being checked.
test("the sketch tool panel shows Trim's 'Checking intersections…' while its query is pending", () => {
  let drawn = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSessionFromSupport(
        { kind: "construction", constructionId: "construction_plane-xy" },
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  for (const [start, end] of [
    [
      [0, 0],
      [4, 0],
    ],
    [
      [1, -1],
      [1, 1],
    ],
  ] as const)
    drawn = acceptSketchDraw(
      startSketchDraw(beginSketchTool(drawn, "line"), [...start]),
      [...end],
    );
  const pending = selectSketchEditToolTarget(
    beginSketchTool(drawn, "trim"),
    drawn.definition.entities[0]!.target,
  );
  expect(pending.definition, "premise: nothing applied yet").toBe(
    drawn.definition,
  );
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchToolPanel
        schema={getSketchToolPresentation(pending)}
        onPatch={() => undefined}
      />
    </MantineProvider>,
  );
  expect(markup).toContain("Checking intersections…");
});

// Lane: UI (docs/testing.md). Seam: the same pending state for a completed
// Extend or Split selection (T10g-2): one queued click, being checked.
test.each(["sketchExtend", "sketchSplit"] as const)(
  "the sketch tool panel shows %s's 'Checking intersections…' while its query is pending",
  (toolId) => {
    let drawn = withSketchSnapScale(
      enterSketchSession(
        createNewSketchSessionFromSupport(
          { kind: "construction", constructionId: "construction_plane-xy" },
          OCC_KERNEL_SETTINGS,
        ),
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    );
    for (const [start, end] of [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [toolId === "sketchExtend" ? 6 : 2, -1],
        [toolId === "sketchExtend" ? 6 : 2, 1],
      ],
    ] as const)
      drawn = acceptSketchDraw(
        startSketchDraw(beginSketchTool(drawn, "line"), [...start]),
        [...end],
      );
    const pending = selectSketchEditToolTarget(
      selectSketchEditToolTarget(
        beginSketchTool(drawn, toolId),
        drawn.definition.entities[0]!.target,
      ),
      drawn.definition.entities[1]!.target,
    );
    expect(pending.definition, "premise: nothing applied yet").toBe(
      drawn.definition,
    );
    const markup = renderToStaticMarkup(
      <MantineProvider>
        <SketchToolPanel
          schema={getSketchToolPresentation(pending)}
          onPatch={() => undefined}
        />
      </MantineProvider>,
    );
    expect(markup).toContain("Checking intersections…");
  },
);

// Lane: UI (docs/testing.md). Seam: the panel renders the session's tool
// presentation (T13-D22): every drawing tool shows the visible "Snap &
// infer" switch with its Shift hint, reflecting the session toggle; edit and
// constraint tools do not show it.
test("the sketch tool panel shows the 'Snap & infer' switch for drawing tools only", () => {
  const session = createNewSketchSessionFromSupport(
    { kind: "construction", constructionId: "construction_plane-xy" },
    OCC_KERNEL_SETTINGS,
  );
  const render = (state: SketchSessionState) =>
    renderToStaticMarkup(
      <MantineProvider>
        <SketchToolPanel
          schema={getSketchToolPresentation(state)}
          onPatch={() => undefined}
        />
      </MantineProvider>,
    );
  const switchInput = (markup: string) =>
    markup.match(/<input[^>]*id="sketch-snap-inference"[^>]*>/)?.[0] ?? null;

  for (const toolId of ["line", "circle", "spline", "point"] as const) {
    const markup = render(beginSketchTool(session, toolId));
    expect(markup, `${toolId}: labelled`).toContain("Snap &amp; infer");
    expect(markup, `${toolId}: hint`).toContain("Hold Shift to place freely");
    expect(switchInput(markup), `${toolId}: on by default`).toContain(
      'checked=""',
    );
    // The switch must not turn the prompt panel into a click blocker over
    // the viewport: only the controls block takes the pointer.
    const panelClass = markup.match(
      /<div[^>]*class="([^"]*absolute z-20[^"]*)"/,
    )?.[1];
    expect(panelClass, `${toolId}: the panel is click-through`).toContain(
      "pointer-events-none",
    );
    expect(
      markup.split("pointer-events-auto").length - 1,
      `${toolId}: one interactive block`,
    ).toBe(1);
    expect(
      markup.indexOf("pointer-events-auto"),
      `${toolId}: it holds the switch`,
    ).toBeLessThan(markup.indexOf('id="sketch-snap-inference"'));
  }
  const off = render(
    beginSketchTool(
      setSketchInferenceSuppression(beginSketchTool(session, "line"), {
        inferenceEnabled: false,
      }),
      "circle",
    ),
  );
  expect(switchInput(off), "the session toggle is off").not.toContain(
    'checked=""',
  );
  for (const toolId of [
    "trim",
    "offset",
    "constraintHorizontal",
    "dimensionDistance",
  ] as const) {
    const markup = render(beginSketchTool(session, toolId));
    expect(markup, `${toolId}: premise, its panel renders`).toContain("Paper");
    expect(markup, `${toolId}: no inference switch`).not.toContain(
      "Snap &amp; infer",
    );
  }
});

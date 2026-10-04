import { expect, test } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

const MODELING_OPERATION_HISTORY_STORAGE_KEY =
  "cad.modeling.operationHistory.doc_workspace.v1";

test.setTimeout(90_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md) — the declared-join closure only exists across
// the real browser session, worker kernel, Finish publication and extrude UI.
// Seam: a rectangle whose closing corner is snapped onto the bottom side
// (a declared point-on-curve incidence, not a shared point), re-solved by a
// dimension edit so the joined corner is no longer bitwise on the side, still
// closes one region that the extrude feature consumes.
test("a snapped rectangle closes through its declared closing corner after a dimension edit and extrudes", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);

  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();

  const canvas = page.locator("main canvas").first();
  const corners = [
    { x: 640, y: 420 },
    { x: 860, y: 420 },
    { x: 860, y: 580 },
    { x: 640, y: 580 },
  ];
  // The bottom side overshoots the closing corner; the last side's end snaps
  // onto the bottom side's body, which declares the closing corner as a
  // point-on-curve incidence. Line chains its sides (T11h): each side's
  // "from" click lands on the chain anchor, a zero-length click that is
  // ignored, so the other corners are shared points.
  await workbench.activateTool("Create line geometry.");
  const sides = [
    [{ x: 580, y: 420 }, corners[1]!],
    [corners[1]!, corners[2]!],
    [corners[2]!, corners[3]!],
    [corners[3]!, corners[0]!],
  ] as const;
  for (const [index, [from, to]] of sides.entries()) {
    await canvas.click({ position: from, force: true });
    await canvas.click({ position: to, force: true });
    await expect
      .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
      .toContain(`${index + 1} entities staged`);
  }

  await workbench.activateTool("Create point-to-point distance dimensions.");
  await page
    .getByRole("menuitem", {
      name: /Distance Create aligned distance dimensions/,
    })
    .click();
  await canvas.click({ position: corners[1]!, force: true });
  await canvas.click({ position: corners[2]!, force: true });
  await canvas.click({ position: { x: 900, y: 500 }, force: true });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput.locator("input").fill("4.5");
  await floatingInput.getByRole("button", { name: "Commit" }).click();
  await expect(floatingInput).toBeHidden();

  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");

  const committed = await page.evaluate((storageKey) => {
    const payload = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: {
          definition?: {
            points?: Array<{
              pointId: string;
              position: readonly [number, number];
            }>;
            entities?: Array<{
              entityId: string;
              startPointId?: string;
              endPointId?: string;
            }>;
            constraints?: Array<{
              kind: string;
              point?: { pointId: string };
              curve?: { entityId: string };
            }>;
          };
        };
      }>;
    };
    const definition = payload.entries
      ?.filter((entry) => entry.kind === "commitSketch")
      .at(-1)?.payload?.definition;
    const incidences =
      definition?.constraints?.filter(
        (constraint) => constraint.kind === "pointOnCurve",
      ) ?? [];
    // Distance of the declared foot from its host line in the committed
    // definition (the positions the kernel solve starts from).
    const position = (pointId?: string) =>
      definition?.points?.find((point) => point.pointId === pointId)?.position;
    const incidence = incidences[0];
    const host = definition?.entities?.find(
      (entity) => entity.entityId === incidence?.curve?.entityId,
    );
    const foot = position(incidence?.point?.pointId);
    const start = position(host?.startPointId);
    const end = position(host?.endPointId);
    const footResidual =
      foot && start && end
        ? Math.abs(
            (end[0] - start[0]) * (foot[1] - start[1]) -
              (end[1] - start[1]) * (foot[0] - start[0]),
          ) / Math.hypot(end[0] - start[0], end[1] - start[1])
        : null;
    const sides =
      definition?.entities?.filter(
        (entity) => entity.startPointId && entity.endPointId,
      ) ?? [];
    return {
      sides: sides.map((side) => [side.startPointId, side.endPointId]),
      points: definition?.points?.length ?? 0,
      pointOnCurve: incidences.length,
      kinds: definition?.constraints?.map((constraint) => constraint.kind),
      footResidual,
    };
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY);
  // T11h: each side after the first continues the line chain from the
  // previous side's end, so consecutive sides share the identical point id.
  expect(committed.sides, "Four line sides are committed.").toHaveLength(4);
  for (const index of [1, 2, 3]) {
    expect(
      committed.sides[index]![0],
      `Side ${index + 1} starts on side ${index}'s end point id.`,
    ).toBe(committed.sides[index - 1]![1]);
  }
  expect(
    committed.points,
    "Five points: the overshooting start, three shared corners and the closing corner.",
  ).toBe(5);
  expect(
    committed.pointOnCurve,
    `The snapped closing corner is declared as a point-on-curve incidence (${committed.kinds}).`,
  ).toBe(1);
  // 1e-12 is three orders above binary64 rounding at this sketch's scale, so
  // the joined corner is a real solver residual off the side, not rounding.
  expect(
    committed.footResidual,
    `After the dimension edit the declared closing corner is not on its host side (residual ${committed.footResidual}).`,
  ).toBeGreaterThan(1e-12);

  await workbench.activateFeature("extrude");
  let regionTargets: string[] = [];
  await expect
    .poll(
      async () => {
        regionTargets = await page.evaluate(
          () =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) =>
                /^sketch_.+\.region_[0-9a-f]{32}$/.test(target),
              ) ?? [],
        );
        return regionTargets.length;
      },
      {
        message:
          "The snapped rectangle publishes exactly one selectable region after Finish.",
        timeout: 15_000,
      },
    )
    .toBe(1);
  await workbench.selectReference(regionTargets[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature();
  await workbench.expectBodyCountAtLeast(1);
});

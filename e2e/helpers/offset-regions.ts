import { expect, type Page } from "@playwright/test";

import {
  activateProfileSlot,
  selectRegionInViewport,
  settledProjections,
  toggleVisibility,
  zoomInAbout,
} from "./acceptance";
import type { FeatureWorkbenchHarness } from "./feature-workbench";

// Offset-region helpers shared by `sketch-offset-regions.spec.ts` and
// `sketch-drag-offsets.spec.ts` (T17i: their region rows pick in the
// viewport, the thin offset regions after a zoom).

export type CommittedSketchDefinition = {
  points: Array<{ pointId: string; position: readonly [number, number] }>;
  entities: Array<{
    entityId: string;
    kind: string;
    startPointId?: string;
    endPointId?: string;
  }>;
  constraints: Array<{
    kind: string;
    point?: { pointId: string };
    curve?: { entityId: string };
  }>;
  derivedRelationships?: Array<{
    kind: string;
    /** T17p3: an offset's distance, stored only as an authored value. */
    distance?: { source: string; value?: number; valueText?: string };
    outputs: Array<{ outputEntityId: string; seedEntityId?: string }>;
  }>;
};

/** The definition of the last sketch commit in the browser's operation history. */
export async function lastCommittedSketch(page: Page) {
  return page.evaluate(() => {
    const payload = JSON.parse(
      window.localStorage.getItem(
        "cad.modeling.operationHistory.doc_workspace.v1",
      ) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: { definition?: unknown };
      }>;
    };
    return (
      payload.entries?.filter((entry) => entry.kind === "commitSketch").at(-1)
        ?.payload?.definition ?? null
    );
  }) as Promise<CommittedSketchDefinition | null>;
}

/**
 * T17i: both regions are picked in the viewport. The offset's thin region
 * (a frame or ring narrower than the part-mode curve band at the default
 * zoom, T17-19) is picked after zooming in about a source line and its
 * offset output (their projected midpoints span its straight part), as in
 * `part-mode-line-pick-radius.spec.ts`. `thickThenThin` returns
 * `[thick, thin]`: hovering
 * a region's projected point (both lie in the thick region; the thin one's
 * is in its hole) names the thick region.
 */
export async function thickThenThin(
  workbench: FeatureWorkbenchHarness,
  regions: readonly string[],
) {
  const page = workbench.page;
  const surface = (await workbench.viewportSurface().boundingBox())!;
  const [point] = await settledProjections(workbench, [regions[0]!]);
  await page.mouse.move(surface.x + point!.x, surface.y + point!.y, {
    steps: 6,
  });
  await workbench.waitForAnimationFrames(2);
  const thick = await workbench.currentHoverTarget();
  expect(regions, "premise: the thick region is hovered").toContain(thick);
  return [thick, regions.find((region) => region !== thick)!] as const;
}

export async function selectThinOffsetRegion(
  workbench: FeatureWorkbenchHarness,
  region: string,
  factor: number,
) {
  const saved = await lastCommittedSketch(workbench.page);
  const offset = saved?.derivedRelationships?.find(
    (relationship) => relationship.kind === "offset",
  );
  const output = offset?.outputs.find((candidate) =>
    saved?.entities.some(
      (entity) =>
        entity.entityId === candidate.outputEntityId &&
        entity.kind === "lineSegment",
    ),
  );
  if (!output?.seedEntityId) throw new Error("No offset line output.");
  const sketchId = region.split(".")[0]!;
  const sides = [
    `${sketchId}.${output.seedEntityId}`,
    `${sketchId}.${output.outputEntityId}`,
  ] as const;
  const at = await zoomInAbout(workbench, sides, sides, factor);
  await selectRegionInViewport(workbench, region, { from: at });
  return at;
}

/**
 * The thin region picked after the thick one was extruded (in a new
 * Extrude, its profile list cleared): the first body is hidden so it
 * cannot take the hover, the consumed (auto-hidden) sketch is shown, the
 * profile slot is re-armed with "+ Add Profile", then the zoomed pick.
 */
export async function pickSecondOffsetRegion(
  workbench: FeatureWorkbenchHarness,
  region: string,
  factor: number,
) {
  const page = workbench.page;
  await toggleVisibility(page, "Hide", "Extrude 1");
  await toggleVisibility(page, "Show", /Sketch/);
  await activateProfileSlot(page);
  return selectThinOffsetRegion(workbench, region, factor);
}

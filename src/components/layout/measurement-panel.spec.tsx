import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { MeasurementPanel } from "@/components/layout/measurement-panel";
import { deriveMeasurementViewModel } from "@/core/measure/measurement";
import { createIdLabelledMeasurementSnapshotForTest } from "@/core/measure/measurement.fixtures";

test("src/components/layout/measurement-panel.spec.tsx", () => {
  const populatedMarkup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
        onDistanceModeChange={() => {}}
        measurement={{
          targetLabels: ["Arc 1 · Sketch 1"],
          rows: [
            { id: "radius", label: "Radius", value: "5 mm" },
            { id: "arc-length", label: "Arc Length", value: "7.85 mm" },
          ],
          note: null,
          witnesses: [],
        }}
      />
    </MantineProvider>,
  );
  expect(
    populatedMarkup.includes("Measure"),
    "Measurement panel should render its section title.",
  ).toBeTruthy();
  expect(
    populatedMarkup.includes("Arc 1 · Sketch 1"),
    "Measurement panel should render the measured target's label.",
  ).toBeTruthy();
  expect(
    populatedMarkup.includes("Arc Length"),
    "Measurement panel should render populated measurement rows.",
  ).toBeTruthy();
  expect(
    populatedMarkup.includes("Diameter"),
    "Measurement panel should not invent hidden measurement labels.",
  ).toBeFalsy();

  const notedMarkup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
        onDistanceModeChange={() => {}}
        measurement={{
          targetLabels: ["Vertex · Body 1"],
          rows: [],
          note: "Select another measurable target to inspect distance.",
          witnesses: [],
        }}
      />
    </MantineProvider>,
  );
  expect(
    notedMarkup.includes("Select another measurable target"),
    "Measurement panel should render note-only point selections.",
  ).toBeTruthy();

  const emptyMarkup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
        onDistanceModeChange={() => {}}
        measurement={{
          targetLabels: ["Unused"],
          rows: [],
          note: null,
          witnesses: [],
        }}
      />
    </MantineProvider>,
  );
  expect(
    emptyMarkup.includes("Unused") || emptyMarkup.includes("Measure"),
    "Measurement panel should stay hidden when no rows or note are available.",
  ).toBe(false);
});

test("cadara-h026.4: the measure readout's markup shows target labels, never a durable id, and no target-count subtitle", () => {
  // Presentation labels are ids here, as OCC's embed topology ids; the
  // per-kind label rules are proven in measurement.spec.ts.
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
        onDistanceModeChange={() => {}}
        measurement={deriveMeasurementViewModel({
          source: "measureTool",
          selection: [
            {
              kind: "vertex",
              bodyId: "body_measure",
              vertexId: "vertex_top_front_left",
            },
            { kind: "face", bodyId: "body_measure", faceId: "face_bottom" },
          ],
          snapshot: createIdLabelledMeasurementSnapshotForTest(),
        })}
      />
    </MantineProvider>,
  );
  for (const label of ["Vertex · Body A", "Face · Body A"]) {
    expect(markup, `the readout names ${label}`).toContain(label);
  }
  for (const id of ["body_measure", "face_bottom", "vertex_top_front_left"]) {
    expect(
      markup,
      `the readout never shows the durable id ${id}`,
    ).not.toContain(id);
  }
  for (const subtitle of ["Single target", "Two targets", " + "]) {
    expect(markup, `no "${subtitle}" subtitle or title join`).not.toContain(
      subtitle,
    );
  }
});

test("cadara-h026.3: a two-target distance readout offers the min / max / centre switch, the only part of the readout that takes pointer events; other readouts have none", () => {
  const render = (distanceMode?: "minimum" | "center") =>
    renderToStaticMarkup(
      <MantineProvider>
        <MeasurementPanel
          onDistanceModeChange={() => {}}
          measurement={{
            targetLabels: ["Line 1 · Sketch 1", "Line 2 · Sketch 1"],
            rows: [{ id: "distance", label: "Distance", value: "3 mm" }],
            note: null,
            witnesses: [],
            ...(distanceMode ? { distanceMode } : {}),
          }}
        />
      </MantineProvider>,
    );
  const markup = render("center");
  expect(markup).toMatch(/role="group"[^>]*aria-label="Distance"/);
  for (const label of ["Min", "Max", "Center"])
    expect(markup, `the switch offers ${label}`).toContain(`>${label}<`);
  expect(
    markup.match(/pointer-events-auto/g),
    "only the switch takes pointer events",
  ).toHaveLength(1);
  expect(markup, "the selected mode is pressed, the others not").toMatch(
    /aria-pressed="true"[^>]*>(<[^>]*>)*Center</,
  );
  expect(markup.match(/aria-pressed="false"/g)).toHaveLength(2);
  expect(render()).not.toContain('aria-label="Distance"');
});

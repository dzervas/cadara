import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { MeasurementPanel } from "@/components/layout/measurement-panel";
import { deriveMeasurementViewModel } from "@/domain/measure/measurement";
import { createIdLabelledMeasurementSnapshotForTest } from "@/domain/measure/measurement.fixtures";

test("src/components/layout/measurement-panel.spec.tsx", () => {
  const populatedMarkup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
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
        measurement={deriveMeasurementViewModel({
          activeToolId: "measure",
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

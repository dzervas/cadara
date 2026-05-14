import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { MeasurementPanel } from "@/components/layout/measurement-panel";

test("src/components/layout/measurement-panel.spec.tsx", () => {
  const populatedMarkup = renderToStaticMarkup(
    <MantineProvider>
      <MeasurementPanel
        measurement={{
          title: "Arc 1",
          subtitle: "Single target",
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
    populatedMarkup.includes("Arc 1"),
    "Measurement panel should render the current selection title.",
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
          title: "Vertex A",
          subtitle: "Single target",
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
          title: "Unused",
          subtitle: "Single target",
          rows: [],
          note: null,
          witnesses: [],
        }}
      />
    </MantineProvider>,
  );
  expect(
    emptyMarkup.includes("Unused") && !emptyMarkup.includes("Measure"),
    "Measurement panel should stay hidden when no rows or note are available.",
  ).toBeFalsy();
});

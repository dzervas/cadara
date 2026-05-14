import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WorkbenchStateDebugger,
  type WorkbenchStateDebuggerModel,
} from "@/components/layout/workbench-state-debugger";

test("src/components/layout/workbench-state-debugger.spec.tsx", async () => {
  function createDebuggerModel(): WorkbenchStateDebuggerModel {
    return {
      activeMode: "part",
      machineState: "editingFeature",
      command: "extrude",
      phase: "editing",
      selectionCount: 2,
      selectionTargets: "sketch_1.region_profile, body_1",
      revision: "rev_12",
      snapshotDiagnosticsCount: 1,
      sketchSession: "4 entities staged",
      sketchPlane: "XY",
      featureSession: "create:extrude:dirty",
      previewState: "Draft extrude profile",
      selectionFilterLabel: "Extrude profiles, planar faces, or boolean bodies",
      activeTargetRule:
        "Join, cut, and intersect require one explicit target body.",
      selectableTargets: ["sketch_1.region_profile", "body_1"],
      featureIds: ["feature_extrude-1"],
      previewDiagnostics: "No diagnostics reported for the current preview.",
      hoverTarget: "none",
      requirements: [
        {
          id: "extrude-profile",
          label: "Extrude seed",
          description:
            "Extrude accepts one explicit derived sketch region or one planar face.",
          slotCount: 1,
        },
        {
          id: "extrude-boolean-target",
          label: "Boolean target",
          description:
            "Join, cut, and intersect require one explicit target body.",
          slotCount: 2,
        },
      ],
      selectionDetail: {
        label: "Profile region",
        kindLabel: "Region",
        ownerLabel: "Sketch 1",
        relatedLabels: ["Extrude 1"],
        targetLabel: "sketch_1.region_profile",
      },
      topologyDebug: {
        bodyCount: 1,
        liveTopologyReferences: 26,
        invalidatedTopologyReferences: 2,
        bodies: [
          {
            bodyId: "body_1",
            label: "Body 1",
            faces: 6,
            edges: 12,
            vertices: 8,
            liveReferences: 26,
            invalidatedReferences: 2,
          },
        ],
        invalidations: [
          {
            reason: "occ-topology-ambiguous",
            count: 2,
            examples: ["body_1.face_old", "body_1.edge_old"],
          },
        ],
      },
    };
  }

  const expandedMarkup = renderToStaticMarkup(
    <WorkbenchStateDebugger state={createDebuggerModel()} defaultExpanded />,
  );
  expect(
    expandedMarkup.includes("State Debugger"),
    "Debugger should render its title.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes("Active mode"),
    "Expanded debugger should render active mode.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes("editingFeature"),
    "Expanded debugger should render machine state.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes("Draft extrude profile"),
    "Expanded debugger should render preview state.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes(
      "Extrude profiles, planar faces, or boolean bodies",
    ),
    "Expanded debugger should render selection filter label.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes("sketch_1.region_profile, body_1"),
    "Expanded debugger should render selected targets.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes(
      "Join, cut, and intersect require one explicit target body.",
    ),
    "Expanded debugger should render selection requirement descriptions.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes("(2 slots)"),
    "Expanded debugger should render selection requirement slot counts.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes("Profile region"),
    "Expanded debugger should render selection detail.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes("Topology naming"),
    "Expanded debugger should include the hidden topology debug section.",
  ).toBeTruthy();
  expect(
    expandedMarkup.includes("occ-topology-ambiguous"),
    "Topology debug section should render invalidation reasons.",
  ).toBeTruthy();

  const collapsedMarkup = renderToStaticMarkup(
    <WorkbenchStateDebugger state={createDebuggerModel()} />,
  );
  expect(
    collapsedMarkup.includes('aria-expanded="false"'),
    "Collapsed debugger should expose collapsed state.",
  ).toBeTruthy();
  expect(
    collapsedMarkup.includes("State Debugger"),
    "Collapsed debugger should retain an expand affordance.",
  ).toBeTruthy();
  expect(
    collapsedMarkup.includes("Active mode"),
    "Collapsed debugger should hide detailed rows.",
  ).toBeFalsy();
  expect(
    collapsedMarkup.includes("Boolean target"),
    "Collapsed debugger should hide requirement rows.",
  ).toBeFalsy();
  expect(
    collapsedMarkup.includes("Topology naming"),
    "Collapsed debugger should hide topology debug rows.",
  ).toBeFalsy();
});

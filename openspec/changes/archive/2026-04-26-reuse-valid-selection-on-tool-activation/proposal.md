## Why

Selection-driven sketch and feature workflows currently make users re-pick geometry after they have already selected valid targets in the viewport or tree. Reusing a valid current selection on tool activation removes unnecessary churn for common flows like starting a sketch from a selected face or offsetting multiple selected sketch edges, while clearing incompatible selections avoids carrying stale or misleading targets into the new command.

## What Changes

- Evaluate the current selection when a supported sketch or feature tool is activated instead of always starting from an empty tool state.
- Reuse the current selection immediately when every selected target is valid for the newly activated tool and can seed that tool's existing draft or command workflow.
- Clear the current selection during tool activation when the selected targets are incompatible with the new tool's selection rules.
- Allow the `Sketch` tool to open directly from a valid preselected planar target.
- Allow selection-driven sketch edit tools, including `offset`, to consume compatible preselected sketch geometry without requiring reselection.
- Seed supported feature create sessions from compatible existing durable selections using the same feature-specific selection semantics already defined by feature authoring.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sketch-target-selection`: `Sketch` can start from a valid preselected planar target and clears incompatible preselection on activation.
- `sketch-tool-definition`: Selection-driven sketch tools can adopt compatible current sketch selections during activation before prompting for new picks.
- `remaining-sketch-tool-behavior`: `offset` can reuse a compatible multi-entity preselection and apply the offset workflow to all accepted selected entities.
- `feature-session-forms`: Supported feature create sessions seed their draft from compatible current durable selections and clear incompatible selections when activation starts.
- `feature-authoring-definition`: Feature activation-time preselection reuse uses each feature's declared selection filter and draft-application rules rather than a shared heuristic.

## Impact

- Affected areas likely include editor-runtime command activation, shared selection state transitions, sketch tool activation plumbing, sketch edit operator/offset authoring logic, and feature session bootstrapping.
- Tests should cover valid preselection reuse, invalid-selection clearing, multi-entity offset activation, sketch-from-preselection, and feature-session seeding from durable topology selections.
- No new dependencies or persistence-format changes are expected; the change should stay within existing selection, tool-definition, and feature-authoring contracts.

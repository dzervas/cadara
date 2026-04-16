## 1. Define the frontend constraint-authoring contract

- [x] 1.1 Add the new `sketch-constraint-authoring` capability spec covering activation, staged target collection, preview rendering, value entry, durable commit, selection, and deletion
- [x] 1.2 Extend the sketch tool/editor schema spec so generic UI surfaces can express cursor hints, viewport annotation previews, and floating value-entry prompts needed by constraint tools
- [x] 1.3 Update the frontend modeling boundary spec so durable constraint create/update/delete flows are explicitly routed through the modeling service and solver boundaries

## 2. Wire sketch constraint tools into the workbench tool system

- [x] 2.1 Add the required sketch constraint and dimension buttons to the tool-definition source of truth, including grouping, icon selection, sketch-mode availability, and dropdown families where appropriate
- [x] 2.2 Define the runtime authoring modules or registry entries for each supported constraint operation without moving toolbar metadata into UI components
- [x] 2.3 Verify that toolbar activation still dispatches through the shared tool action bus before constraint-specific authoring behavior runs

## 3. Build staged constraint authoring flow

- [x] 3.1 Extend sketch-session/controller state to track active constraint operation, ordered target selection, hover candidate, preview descriptors, and pending numeric input
- [x] 3.2 Implement cursor and viewport preview behavior for active constraint operations, including “preview-like” rendering before commit
- [x] 3.3 Implement generic floating input presentation for operations that require authored values such as length, distance, angle, or radius

## 4. Commit durable constraint data and render document-backed annotations

- [x] 4.1 Route successful constraint create/update/delete actions through the frontend-facing modeling boundary so committed constraint and dimension records are stored in the sketch document
- [x] 4.2 Generate committed viewport annotation descriptors from durable sketch records and solved geometry rather than from transient UI state
- [x] 4.3 Support selecting committed constraint annotations and deleting them through the existing editor/modeling command flow

## 5. Verify separation and behavior

- [x] 5.1 Add or update tests for toolbar exposure, staged target collection, preview descriptor generation, and floating input behavior for at least one geometric and one dimensional constraint
- [x] 5.2 Add or update tests for committed constraint annotation rendering, selection, and deletion against durable sketch IDs
- [x] 5.3 Verify that frontend components do not import solver implementation code, that solver modules do not import React/viewport code, and that durable constraint mutations continue to cross the modeling boundary

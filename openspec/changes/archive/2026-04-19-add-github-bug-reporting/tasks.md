## 1. GitHub Issue Form

- [x] 1.1 Add `.github/ISSUE_TEMPLATE/bug_report.yml` with fields for summary, steps to reproduce, actual behavior, expected behavior, frequency, screenshots/recordings, environment, diagnostics, and debug payload.
- [x] 1.2 Ensure the issue form includes attachment instructions for generated debug artifacts and keeps large debug JSON visually separate from human reproduction fields.

## 2. Report Payload Model

- [x] 2.1 Add a bug-report payload module with typed sections for build metadata, browser metadata, viewport/WebGL metadata, route context, editor context, diagnostics/errors, document summary, authored document, operation history, and payload status.
- [x] 2.2 Reuse `createAuthoredModelDocumentFromSnapshot` for document reproduction data and exclude derived snapshot/render/presentation state.
- [x] 2.3 Add operation-history loading that reads the existing local storage key, validates the payload, and records invalid/unavailable/omitted states without throwing.
- [x] 2.4 Add compact transient editor-context extraction for active sketch, feature edit, preview, selection command, selection targets, and reference-picker state.

## 3. Formatting and Size Policy

- [x] 3.1 Implement Markdown formatting helpers that wrap inline debug JSON in `<details><summary>...</summary>` blocks with fenced code sections.
- [x] 3.2 Implement per-section and total inline byte limits so large document/history/debug sections are omitted from the issue prefill with explicit markers.
- [x] 3.3 Implement GitHub issue URL generation for the specific bug template using only bounded query parameters and issue-form field ids.
- [x] 3.4 Implement a downloadable JSON or zip debug artifact fallback for omitted high-value sections, using a deterministic timestamped filename referenced by the issue prefill.

## 4. Workbench Integration

- [x] 4.1 Add an icon-only Mantine report-bug action to the workbench shell or toolbar with accessible label, tooltip, and local icon asset.
- [x] 4.2 Wire the action to collect the active workbench context, generate the bounded issue URL, create any required debug artifact, and open GitHub in a new tab.
- [x] 4.3 Ensure report generation failure does not block GitHub issue creation; include an inline unavailable marker when artifact or metadata collection fails.

## 5. Verification

- [x] 5.1 Add unit tests for payload construction, authored-document extraction, operation-history statuses, and transient editor-context inclusion.
- [x] 5.2 Add unit tests for Markdown disclosure formatting, inline-size omission, artifact filename generation, and issue URL query bounds.
- [x] 5.3 Add component coverage that verifies the workbench report-bug action renders with the expected accessibility label, tooltip, and target behavior.
- [x] 5.4 Run `bun run test`, `bun run lint`, and `bun run build`.

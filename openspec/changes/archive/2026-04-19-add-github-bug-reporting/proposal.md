## Why

Users can currently hit modeling, viewport, or workflow bugs without an easy way to send the exact context needed to reproduce them. A dedicated GitHub bug-report flow should capture high-signal environment, document, action, and diagnostic data while keeping the public issue readable and avoiding oversized URL/query payloads.

## What Changes

- Add a workbench "Report bug" affordance that opens the Cadara GitHub repository's bug issue form.
- Add a GitHub issue form template dedicated to app bug reports, with fields for reproduction steps, actual/expected behavior, environment, diagnostics, and debug payloads.
- Generate a structured bug-report payload from the active workbench context, prioritizing durable authored document data, operation history, diagnostics, recent actions, and compact editor context.
- Inline only small debug chunks into the prefilled GitHub issue body or form fields, and wrap larger chunks in Markdown `<details>` sections when included in the issue content.
- Fall back to a downloadable debug artifact when the document/history payload is too large or unsuitable for URL prefill.
- Avoid treating full transient UI state as the default reproduction input; include transient sketch/feature/editing state only when it is relevant to the active workflow.

## Capabilities

### New Capabilities

- `github-bug-reporting`: User-facing GitHub bug-report workflow, issue form contract, report payload contents, inline-size policy, and large-payload fallback behavior.

### Modified Capabilities

- None.

## Impact

- Adds `.github/ISSUE_TEMPLATE/bug_report.yml`.
- Adds bug-report payload construction and URL generation under app/domain/lib code.
- Updates the workbench toolbar or shell chrome to expose the report action with Mantine styling and local icon assets.
- Reuses existing authored document, operation-history, diagnostics, build metadata, and error-reporting context contracts where practical.
- May use the existing `fflate` dependency for downloadable debug artifacts; no backend or GitHub write token is required for the first implementation.

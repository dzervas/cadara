## Context

Cadara already has the pieces needed for a high-signal bug report: build metadata, a central error reporter, active document telemetry derived from `AuthoredModelDocument`, modeling diagnostics, editor/workbench state, and local operation history. The missing piece is a user-facing flow that packages those signals into a GitHub issue without turning the issue body into an unreadable dump.

GitHub issue URLs and issue-form field prefills are useful for small metadata, but they are not a reliable transport for full document or history payloads. Large query strings can fail before the issue page loads, and public issue bodies should keep bulky JSON behind Markdown disclosure blocks. The first implementation should stay frontend-only and avoid embedding GitHub credentials in the browser.

## Goals / Non-Goals

**Goals:**

- Provide a workbench affordance that opens a specific Cadara GitHub bug issue form.
- Prefill the issue with concise environment, build, active workflow, diagnostics, and reproduction placeholders.
- Include debug JSON in Markdown `<details>` sections when it is small enough to safely inline.
- Fall back to a downloadable debug artifact for large document, operation-history, screenshot, or console payloads.
- Prefer durable authored document state and operation history over full transient React/editor state.
- Capture transient sketch/feature/editing state only when the active workflow makes it relevant.

**Non-Goals:**

- Automatically submit GitHub issues from the browser.
- Automatically upload attachments to GitHub.
- Add a backend, object-storage bucket, or GitHub OAuth/token flow.
- Capture private user identity data, secrets, or arbitrary local storage.
- Replace Sentry/Bugsink production error telemetry.

## Decisions

### Use a GitHub issue form plus URL prefill

The repository SHALL add `.github/ISSUE_TEMPLATE/bug_report.yml` with clear fields for summary, reproduction steps, expected behavior, actual behavior, frequency, environment, diagnostics, and debug payload. The app will open `/issues/new?template=bug_report.yml` and prefill fields by id where practical.

Alternative considered: generate only a classic `body=` Markdown issue URL. That is simpler, but issue forms give required fields, upload support, and a better triage shape.

### Inline a compact report, not the whole world

The report generator SHALL build a small always-inline payload containing build metadata, browser metadata, viewport/WebGL metadata, route/query context, active editor mode, active command, selected targets, diagnostics summary, and document counts. This data is useful for triage and remains readable.

Alternative considered: serialize the complete editor machine state. That would be noisy, less stable, and often impossible to restore directly. It also risks exposing derived UI details that do not help reproduce modeling bugs.

### Treat authored document as the canonical reproduction state

When document data is included, the generator SHALL use the authored model document representation derived from the active snapshot rather than the full `DocumentSnapshot`. This excludes render exports, presentation trees, selection catalogs, preview geometry, and OpenCascade runtime artifacts while retaining rebuild inputs.

Alternative considered: include the full current snapshot. That could help with viewport bugs, but it is larger and includes derived state that should be regenerated from authored input.

### Include operation history as a separate signal

The generator SHALL include operation-history metadata and, when small enough, recent operation entries. Operation history helps reproduce workflow bugs involving undo/redo, rollback, feature ordering, history persistence, or "after doing X then Y" failures.

Alternative considered: rely only on the final authored document. That is sufficient for many kernel/modeling failures but loses the temporal sequence needed for editor/history bugs.

### Use Markdown disclosure blocks for bulky inline sections

Generated Markdown for debug data SHALL wrap any JSON chunks in `<details><summary>...</summary>` sections with fenced code blocks. This keeps the issue readable while allowing maintainers to expand exact reproduction data when needed.

Alternative considered: put JSON directly in visible textareas. That makes triage harder and pushes the human description below machine data.

### Download artifact fallback for large payloads

When a payload exceeds the inline threshold, the app SHALL generate a downloadable JSON or zip artifact and prefill the issue with an explicit note asking the reporter to attach it. The artifact can contain the authored document, operation history, recent console/error entries, screenshot/canvas capture if available, and the compact report.

Alternative considered: force everything through query parameters. That is brittle because URL limits vary across browsers, proxies, and GitHub, and it exposes large data in history/logs.

## Risks / Trade-offs

- Large reports still require a manual attachment step -> Mitigation: make the generated issue text clearly state the downloaded filename and where to attach it.
- Users may submit reports without the attachment -> Mitigation: keep the compact inline payload useful enough for initial triage and mark large payload status explicitly.
- Debug payloads may contain sensitive model details -> Mitigation: make report generation user-initiated, prefer public-safe metadata inline, and keep large authored document data in an explicit attachment flow.
- Browser metadata APIs vary -> Mitigation: collect `navigator.userAgentData` only when available and always include a `navigator.userAgent` fallback.
- Screenshots or canvas captures may fail due to browser/graphics constraints -> Mitigation: treat visual capture as best-effort and never block issue creation.
- Adding a toolbar affordance can clutter dense CAD chrome -> Mitigation: use one icon-only Mantine action with a tooltip, consistent with the existing toolbar style.

## Context

The workbench already centralizes tool metadata in `src/domain/tools/` and routes tool activations through `ToolActionBus` and `useToolActions`. A few keyboard behaviors currently live as local `window` keydown handlers, which will become brittle as shortcuts expand to tools, editor commands, context menus, and user customization.

## Goals / Non-Goals

**Goals:**

- Model keyboard actions as commands with stable ids, labels, scopes, default shortcuts, and enablement checks.
- Normalize shortcuts from `event.key`, not physical key codes.
- Support modifier chords and multi-key sequences such as `g>f`.
- Keep custom shortcut persistence out of document/modeling state by designing around an effective keymap.
- Provide pure parser, formatter, conflict detection, and resolver behavior that is easy to test with `bun:test`.

**Non-Goals:**

- No customization UI.
- No profile sync implementation.
- No broad tooltip or context-menu display rollout.
- No large rewrite of tool definitions or editor state.

## Decisions

- Build a small internal shortcut domain instead of making a hotkey library the architecture. Libraries can match keys, but command identity, scope priority, profile overrides, sequence conflicts, and generated UI hints are application contracts.
- Use `event.key` for matching. This honors the user's keyboard layout and matches the requested behavior; physical-key support is intentionally out of scope.
- Use command ids as the durable join between behavior and presentation. Tool commands can be derived from tool definitions, while editor commands can be declared independently.
- Represent defaults and overrides separately. The effective keymap merges defaults with profile overrides, where an empty override list means "disabled".
- Disallow ambiguous same-scope prefix conflicts in the first implementation, such as binding both `g` and `g>f` in the same active scope. This keeps sequence dispatch immediate and predictable.

## Risks / Trade-offs

- Custom resolver code can grow if requirements expand → Keep the grammar deliberately small and heavily unit tested.
- `event.key` shortcuts vary by keyboard layout → This is requested behavior; formatter and parser should describe logical keys, not physical positions.
- Scopes can become unclear if every component invents its own names → Start with a small shared scope set: global, part, sketch, active-tool, focused-panel, modal.
- Prefix conflicts reduce binding freedom → Prefer clear diagnostics over delayed single-key execution for the initial system.

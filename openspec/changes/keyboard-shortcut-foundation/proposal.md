## Why

Keyboard shortcuts need to become a first-class interaction layer before shortcut behavior spreads through one-off component handlers. Establishing the foundation now lets tools, editor commands, sequences, and future profile-level customization share one command/keymap model.

## What Changes

- Introduce a command registry that can represent toolbar tools and non-tool workbench actions.
- Introduce a default keymap with `event.key`-based shortcut parsing, formatting, conflict detection, and multi-key sequence support.
- Introduce an effective keymap model that can merge user-profile overrides later without storing shortcuts in document state.
- Introduce a shortcut resolver/provider that understands scopes, text-editing guards, disabled commands, and command execution.
- Keep the foundation UI-light: no customization screen and no broad shortcut display rollout in this phase.

## Capabilities

### New Capabilities

- `keyboard-shortcut-foundation`: Core command registry, keymap, parser/formatter, sequence resolver, and effective shortcut model.

### Modified Capabilities

- None.

## Impact

- Affected areas: `src/domain/`, `src/hooks/`, workbench action contracts, and tests.
- `ToolSource` will need room for keyboard-triggered commands in later phases, but broad toolbar integration is intentionally deferred.
- No new runtime dependency is required unless implementation reveals that a small parser/listener library materially reduces code.

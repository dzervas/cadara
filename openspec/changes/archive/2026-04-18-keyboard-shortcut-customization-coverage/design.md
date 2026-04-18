## Context

Earlier shortcut phases establish command identity, execution, and visibility. Customization should therefore edit profile override data and let the effective keymap update execution and display. Shortcuts must not be stored in document data because user preferences should apply across documents for the same profile.

## Goals / Non-Goals

**Goals:**

- Persist shortcut overrides at a user-profile boundary.
- Let users record, remap, disable, reset individual commands, and reset all shortcuts.
- Validate conflicts before saving.
- Expand command coverage beyond toolbar tools.
- Generate a shortcut reference from command/keymap data.

**Non-Goals:**

- No server-backed account sync unless a profile repository already exists.
- No document-level shortcut overrides.
- No support for arbitrary scripting or macros.

## Decisions

- Define a `ShortcutProfileRepository` abstraction. Start with a local profile implementation, but keep the API compatible with future user-account sync.
- Store only overrides, not a full copied keymap. This keeps new defaults available after upgrades and makes reset behavior simple.
- Use the same parser and conflict detector for the customization UI and runtime effective keymap.
- Treat an empty override list as disabled. Treat absence of an override as "use defaults".
- Build the reference surface from the registry so it cannot drift from real commands.

## Risks / Trade-offs

- Recording sequences can conflict with active app shortcuts → The recording input should capture keys in an isolated modal/focused state.
- Local profile storage is not true user sync → The repository boundary makes later sync an implementation swap.
- Broad command coverage can balloon scope → Prioritize existing visible context-menu and viewport actions first.

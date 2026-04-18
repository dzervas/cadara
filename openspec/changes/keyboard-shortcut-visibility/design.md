## Context

Toolbar tooltips already separate title and description. Context menu entries are declared as data and rendered through a shared `WorkbenchContextMenu`. These are good integration points for shortcut hints as long as display is driven by command ids and the effective keymap rather than by manually appending text to labels.

## Goals / Non-Goals

**Goals:**

- Show shortcut hints consistently in all primary action discovery surfaces.
- Keep shortcut labels generated from the effective keymap.
- Allow custom/remapped shortcuts to update display automatically in later phases.
- Preserve compact CAD-style UI density.

**Non-Goals:**

- No shortcut customization UI.
- No complete command coverage for every possible action if a command id does not exist yet.
- No manual shortcut text inside tooltip descriptions or menu labels.

## Decisions

- Add a small shared shortcut hint component instead of repeating markup across tooltips, dropdowns, and context menus.
- Resolve hints by command id. Tool UI can derive `tool.<id>` command ids, while context menu entries can opt in through `commandId`.
- Use a right-aligned menu section for context menu shortcuts to match common desktop application patterns.
- Hide hints for disabled/unassigned shortcuts rather than showing placeholders.

## Risks / Trade-offs

- Tooltips can become visually noisy → Keep hint treatment compact and secondary to the command label.
- Context menu actions without command ids will not show hints → This is acceptable until the coverage phase assigns more command ids.
- Server-side/static render tests may not have platform context → Formatter should support deterministic test options.

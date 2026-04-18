## 1. Profile Persistence Boundary

- [x] 1.1 Add a shortcut profile repository interface and local profile implementation
- [x] 1.2 Load and save shortcut overrides without touching document state
- [x] 1.3 Add persistence tests for default, override, disable, and reset behavior

## 2. Customization UI

- [x] 2.1 Add a shortcut settings/reference surface using Mantine components
- [x] 2.2 Add shortcut recording for chords and multi-key sequences
- [x] 2.3 Add remap, disable, reset command, and reset all controls
- [x] 2.4 Add UI tests for editing, disabling, conflicts, and immediate display updates

## 3. Expanded Command Coverage

- [x] 3.1 Add command ids for high-value context menu actions in sidebar and timeline surfaces
- [x] 3.2 Add command ids for viewport navigation and selection commands
- [x] 3.3 Add optional defaults only where they are low-conflict and mode-appropriate
- [x] 3.4 Document or encode rationale for visible actions that remain non-command actions

## 4. Generated Reference

- [x] 4.1 Generate shortcut reference groups from command registry categories and effective keymap data
- [x] 4.2 Ensure customized, disabled, and sequence shortcuts render accurately in the reference

## 5. Verification

- [x] 5.1 Run `bun run test`
- [x] 5.2 Run `bun run lint`

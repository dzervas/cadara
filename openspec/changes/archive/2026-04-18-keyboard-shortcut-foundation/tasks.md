## 1. Command And Keymap Domain

- [x] 1.1 Add typed command definitions for tool-derived and editor-declared commands
- [x] 1.2 Add default keymap and profile override types without tying shortcuts to document state
- [x] 1.3 Add command registry tests for tool command derivation and non-tool command declaration

## 2. Shortcut Grammar

- [x] 2.1 Implement `event.key`-based shortcut parsing for chords and sequences
- [x] 2.2 Implement platform-aware shortcut formatting from normalized shortcut data
- [x] 2.3 Add parser and formatter tests for modifiers, aliases, and sequences

## 3. Effective Keymap And Conflicts

- [x] 3.1 Implement default/profile override merging, including disabled shortcuts
- [x] 3.2 Implement duplicate and prefix conflict detection across overlapping scopes
- [x] 3.3 Add keymap merge and conflict tests

## 4. Resolver Foundation

- [x] 4.1 Implement a shortcut resolver/provider that tracks sequence state and active scopes
- [x] 4.2 Add text-editing target guards and command enablement checks
- [x] 4.3 Add resolver tests for scope priority, ignored text targets, disabled commands, and sequences

## 5. Verification

- [x] 5.1 Run `bun run test`
- [x] 5.2 Run `bun run lint`

## 1. Tool Metadata And Families

- [x] 1.1 Add tool ids, metadata, icons, and registration for all primitive constructor tools.
- [x] 1.2 Add dropdown families for line, rectangle, circle, arc, and polygon variants.
- [x] 1.3 Update toolbar/search/shortcut-facing tests so sketch-mode discovery includes the new tools.

## 2. Constructor Tool Modules

- [x] 2.1 Implement point and midpoint-line tool modules with staged preview, validation, and commit output.
- [x] 2.2 Implement center-point and aligned rectangle modules with live measurements and constraint output.
- [x] 2.3 Implement 3-point circle, 3-point arc, tangent arc, and center-point arc modules.
- [x] 2.4 Implement inscribed and circumscribed polygon modules.

## 3. Constraint And Commit Integration

- [x] 3.1 Add shared helpers for constructor-authored constraints and dimensions where they reduce duplication.
- [x] 3.2 Ensure constructor commits honor construction mode and accepted snap constraints.
- [x] 3.3 Prevent duplicate inferred constraints when constructor-authored constraints already express the same relationship.

## 4. Verification

- [x] 4.1 Add focused sketch tool lifecycle and sketch session commit tests for each constructor family.
- [x] 4.2 Run `bun run test`.
- [x] 4.3 Run `bun run lint`.
- [x] 4.4 Run `bun run build`.

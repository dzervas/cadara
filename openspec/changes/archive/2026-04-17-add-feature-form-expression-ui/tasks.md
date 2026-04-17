## 1. Form State And Validation Helpers

- [x] 1.1 Add centralized form-layer source state for expression-capable fields so literal and expression-authored values are distinguishable without string inference.
- [x] 1.2 Add or export a shared field-level expression preview helper that validates expression text against document variables and the field value kind.
- [x] 1.3 Add form adapter tests for literal values, expression values, numeric-looking expression text, enum expression text, and unsupported reference fields.

## 2. Feature Inspector Expression UI

- [x] 2.1 Add a reusable `react-hook-form` expression field wrapper for expression-capable non-reference controls.
- [x] 2.2 Render the local `function.svg` `f(x)` affordance with normal and active foreground states.
- [x] 2.3 Implement expression edit mode with text input replacement, live result preview at the input end, invalid expression feedback, Enter/blur acceptance, and red clear action.
- [x] 2.4 Wire expression acceptance and clearing through existing feature draft patch helpers so accepted expressions preserve raw text and cleared expressions return to literal input.
- [x] 2.5 Apply the wrapper to current numeric and enum field renderers without changing reference picker or reference collection behavior.

## 3. Verification

- [x] 3.1 Add focused React rendering tests for affordance visibility, active expression presentation, edit mode, invalid preview, Enter/blur acceptance, and clear-to-literal behavior.
- [x] 3.2 Run `bun run test`.
- [x] 3.3 Run `bun run lint`.

## 1. Form Runtime Setup

- [x] 1.1 Add `react-hook-form` to `package.json` and update the Bun lockfile.
- [x] 1.2 Introduce a feature-form adapter module that derives normalized form values from `FeatureEditorFormSchema` and translates RHF value changes back into existing feature patch helpers.
- [x] 1.3 Add focused tests for the adapter path, including numeric value handling, angle-degree patch translation, and reference-value normalization.

## 2. Feature Inspector Migration

- [x] 2.1 Refactor `src/components/layout/feature-inspector.tsx` to create and use a `react-hook-form` instance for active feature-session forms.
- [x] 2.2 Migrate numeric and enum field rendering to RHF registration/controller bindings while preserving current field styling, helper text, and error presentation.
- [x] 2.3 Preserve the existing commit and cancel buttons as editor command actions instead of introducing form-local submit semantics.

## 3. External Session and Reference Picker Sync

- [x] 3.1 Implement guarded RHF reset/synchronization logic so feature reopen, feature hydration, and external session changes update form state without clobbering local typing unnecessarily.
- [x] 3.2 Bridge reference picker and reference collection fields through RHF value updates while preserving `form.referencePickerActivated`, selection filters, and machine-owned durable selection handling.
- [x] 3.3 Remove any now-redundant direct input-to-patch wiring that the RHF-backed feature inspector replaces, without changing sketch-only authoring controls.

## 4. Verification

- [x] 4.1 Update `src/components/layout/feature-inspector.spec.tsx` to cover RHF-backed rendering, reset behavior, and unchanged active picker/error states.
- [x] 4.2 Update or add editor/feature-authoring tests to verify reference-picker selections and domain coercion still produce the expected feature draft patches after the migration.
- [x] 4.3 Run `bun run test` and `bun run lint`.

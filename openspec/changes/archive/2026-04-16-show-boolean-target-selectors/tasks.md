## 1. OpenSpec Artifacts

- [x] 1.1 Create proposal, design, spec, and task artifacts for `show-boolean-target-selectors`
- [x] 1.2 Validate the OpenSpec change

## 2. Basic Feature Forms

- [x] 2.1 Add conditional target body collection fields to extrude, revolve, and shell schemas
- [x] 2.2 Ensure basic boolean target body selections update `booleanScope` through existing patch handling
- [x] 2.3 Ensure switching basic features back to `newBody` produces standalone scope

## 3. Regression Coverage

- [x] 3.1 Add authoring tests for extrude, revolve, and shell target selector visibility and target scope output
- [x] 3.2 Add regression assertions that advanced feature target selectors remain hidden for `create` and visible for boolean intents

## 4. Verification

- [x] 4.1 Run `bun run test`
- [x] 4.2 Run `bun run lint`

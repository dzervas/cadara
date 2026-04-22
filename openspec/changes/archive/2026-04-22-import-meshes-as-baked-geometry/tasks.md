## 1. Contracts

- [x] 1.1 Add mesh import feature definition types for baked asset id, source provenance, resolved settings, and `sourceStored: false`.
- [x] 1.2 Add generated baked geometry asset metadata distinct from retained STEP source assets.
- [x] 1.3 Add diagnostics for source-discard warning, parse failure, and basic conversion failure.
- [x] 1.4 Add contract tests proving raw mesh bytes and triangle arrays are rejected from authored records.

## 2. Mesh Parsing

- [x] 2.1 Add transient STL parsing for binary and ASCII triangle sources.
- [x] 2.2 Add transient 3MF ZIP/XML parsing for geometry vertices and triangles only.
- [x] 2.3 Reject 3MF cases where unsupported metadata is required to interpret geometry correctly.
- [x] 2.4 Add parser tests for STL, triangle-only 3MF, unsupported 3MF, and medium-size payload behavior.

## 3. Baking Pipeline

- [x] 3.1 Add transient basic mesh-to-baked-geometry conversion entry point with strict rejection semantics.
- [x] 3.2 Serialize accepted baked geometry into immutable generated geometry assets.
- [x] 3.3 Ensure restore reads baked geometry assets and never requires original STL or 3MF source bytes.
- [x] 3.4 Add tests for successful baked import, rejected conversion, and source bytes absent after save.

## 4. UI And Persistence

- [x] 4.1 Add workbench import entry for `.stl` and `.3mf` files.
- [x] 4.2 Add source-discard warning that must be accepted before committing mesh import.
- [x] 4.3 Show parsing/conversion progress and structured diagnostics.
- [x] 4.4 Verify self-contained save/open and peer sync restore baked mesh imports without source meshes.
- [x] 4.5 Run `bun run test`, `bun run lint`, and `bun run build`.

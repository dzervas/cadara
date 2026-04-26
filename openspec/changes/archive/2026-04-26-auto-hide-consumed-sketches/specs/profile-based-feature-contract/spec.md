## ADDED Requirements

### Requirement: Applied profile-based features SHALL expose consumed sketch ownership for visibility derivation
Applied profile-based features SHALL expose enough durable rebuild metadata to identify which committed sketches own the consumed profile references, so consumed-sketch visibility can be derived during commit, replay, and reload without using transient UI selection state.

#### Scenario: Rebuilt feature marks its source sketch as consumed
- **WHEN** an applied profile-based feature rebuilds from one or more sketch-region profile references owned by a committed sketch
- **THEN** the rebuilt snapshot exposes that committed sketch as consumed by the applied feature through durable snapshot or presentation metadata

#### Scenario: Reload preserves consumed sketch ownership
- **WHEN** a document reloads and replays an applied profile-based feature that consumes a committed sketch-owned profile
- **THEN** the rebuilt snapshot exposes the same consumed sketch ownership without depending on previously cached UI visibility state

#### Scenario: Planar-face profiles do not invent consumed sketches
- **WHEN** an applied profile-based feature rebuilds from planar-face profile references that are not owned by a committed sketch
- **THEN** the rebuilt snapshot does not mark an unrelated sketch as consumed solely because the feature uses those non-sketch profiles

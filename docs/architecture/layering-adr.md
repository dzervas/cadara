# ADR: Layered Runtime Boundaries

## Status

Accepted

## Context

The codebase already separates `src/contracts`, `src/app`, `src/hooks`, and `src/components`, but `src/domain` currently mixes three different concerns:

- pure editor/modeling rules
- application orchestration and use-case sequencing
- browser, worker, storage, and rendering adapters

That makes the folder name misleading. New code is hard to place because "domain" does not describe a single dependency rule.

## Decision

The repo will incrementally move toward these top-level implementation layers:

- `src/contracts`: stable schemas, contract types, runtime validation, and transport boundaries
- `src/core`: pure modeling/editor/tool logic and deterministic state transitions
- `src/application`: use cases, orchestration, effect runtimes, and non-React command services
- `src/infrastructure`: browser, worker, storage, OCC, and rendering adapters
- `src/app`, `src/hooks`, `src/components`: composition and UI adapters

## Dependency Rules

- `contracts` must not import `core`, `application`, or `infrastructure`
- `core` may import only `contracts` and other `core` modules
- `core` must not import `react`, browser globals, `three`, `@react-three/*`, or persistence APIs
- `application` may import `contracts` and `core`
- `application` must not import `react`
- `infrastructure` may depend on `contracts`, `core`, and `application` ports where needed
- `hooks` should remain thin React adapters over `application` services
- `app` owns top-level composition

## Classification Heuristic

- If the code answers "what should happen?", it belongs in `core`
- If the code answers "in what order do we call collaborators?", it belongs in `application`
- If the code answers "how do we talk to browser, worker, storage, OCC, or rendering libraries?", it belongs in `infrastructure`

## Migration Policy

- Move code incrementally by slice
- Prefer compatibility re-exports during migration instead of big-bang renames
- Add boundary tests before broad moves
- When a touched module is clearly orchestration or adapter code, move it to `application` or `infrastructure`

## Initial Moves

This change establishes the new roots and begins the migration by:

- extracting app editor effect orchestration into `src/application/editor`
- extracting workbench document-owner orchestration into `src/application/workbench`
- moving selected browser and persistence adapters into `src/infrastructure`
- adding architecture boundary tests for the new layers

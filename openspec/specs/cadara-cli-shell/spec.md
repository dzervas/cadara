# cadara-cli-shell Specification

## Purpose
TBD - created by archiving change add-onshape-capture-bundle. Update Purpose after archive.
## Requirements

### Requirement: The cadara CLI SHALL dispatch to registered subcommands
The CLI entrypoint SHALL route invocations of the form `cadara <group> <command> [args]` to registered command modules and SHALL own usage output and exit codes, so future subcommands are added by registration rather than by restructuring the entrypoint.

#### Scenario: Known subcommand is invoked
- **WHEN** the user runs `cadara onshape capture <url>`
- **THEN** the dispatcher resolves the `onshape capture` command module and invokes it with the remaining arguments, environment accessor, and IO streams

#### Scenario: Unknown subcommand is invoked
- **WHEN** the user runs `cadara` with a group or command that is not registered
- **THEN** the CLI prints usage listing available subcommands to stderr
- **AND** exits with code 2 without performing any work

#### Scenario: Command fails
- **WHEN** an invoked command reports a failure
- **THEN** the CLI prints the structured failure reason to stderr
- **AND** exits with code 1
- **AND** does not swallow or reinterpret the underlying error detail

### Requirement: CLI subcommands SHALL reuse app contracts without importing browser-bound code
Subcommands SHALL consume shared code from `src/contracts/` and `src/domain/` and SHALL NOT import from browser-bound modules such as `src/components/`, `src/workbench/`, or viewport infrastructure.

#### Scenario: Subcommand validates a payload
- **WHEN** a subcommand produces or consumes a contract-typed payload
- **THEN** it validates the payload with the same Typia-generated validators the app uses for that contract

#### Scenario: Subcommand accidentally references UI code
- **WHEN** a subcommand module imports a browser-bound module
- **THEN** static verification (lint/build for the CLI target) fails rather than the breakage surfacing at runtime

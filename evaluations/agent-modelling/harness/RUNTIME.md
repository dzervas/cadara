# CADara persistent runtime (trial prototype)

The runtime keeps **one document open** across many script runs, so you build a model step by step without replaying or reopening it.

- `cadara-rt start` starts the runtime for the current directory. The document state persists until `stop`.
- `cadara-rt run <script.ts>` runs a script (same shape and `cad` API as SDK.md) against the open document. The `cad` object, including `cad.last` and `cad.log`, carries over between runs. A failed operation leaves everything before it applied (there is no rollback); fix it and run another script that continues from the current state.
- `cadara-rt inspect` prints `cad.inspect()`.
- `cadara-rt labels [kind]` prints the selectable labels.
- `cadara-rt topology [face|edge|vertex]` prints topology without refs.
- `cadara-rt log` prints all step summaries so far.
- `cadara-rt stop` closes the document and stops the runtime. Save first if you need the file.

Typical flow: create the document and variables in one script, inspect, add a sketch in the next, check the solve status, extrude, and so on. You can still do everything in one script if you prefer.

# CADara SDK (trial prototype)

You model native CADara parts by writing a TypeScript script against a small SDK. The SDK runs the **same semantic operations** as the `cadara document recipe` CLI. Operation names, fields, units, selectors, outcomes and refusals are identical, so the CLI docs remain the authority for each operation:

- `CLI_README.md`: fields, units, variants and selector rules per operation. Read an operation's section before you use it.
- `CLI_COVERAGE.md`: the closed operation list.
- `CLI_SKILL.md`: the CLI modelling skill. Its design-intent guidance, units, receipts, failure signals and pitfalls all apply to you. Its workflow and recipe bookkeeping (`commandId`, `as`, `basis`, `draft`, save/reopen staging) are handled by the SDK instead.
- `cadara document recipe --schema <operation>` prints one operation's exact JSON shape and units.

## Script shape

```ts
export default async function (cad) {
  await cad.op("document.create", { label: "Part" });
  const s = await cad.op("sketch.begin", { plane: "xy" });
  await cad.op("sketch.author", {
    primitive: { kind: "rectangle", start: [0, 0], end: [40, 20] },
    construction: false,
  });
  const sk = await cad.op("sketch.publish", { requireProfiles: true });
  await cad.op("extrude.create", {
    profile: sk.ref("Outer region", sk),
    depth: 4,
  });
  return cad.inspect(); // whatever you return is printed as JSON
}
```

## API

- `await cad.op(operation, fields)` runs one operation. Pass the operation's fields _without_ `version`, `commandId`, `basis`, `draft`, `intent` or `as`; the SDK fills them in:
  - basis = latest successful step
  - draft = current private sketch draft
  - intent = `"fulfill"` unless you pass `intent`

  It returns a **Step**. If the operation does not complete, it **throws** a `CadFailure` whose message carries the outcome, reason and diagnostics. Selection errors include `candidates`.

- `await cad.tryOp(operation, fields)` is the same as `op()` but never throws. Check `step.ok`, `step.summary()` and `step.result`.
- `step.ref(label, sketchStep?)` gives a CLI-style selector `{alias, label[, sketch]}` resolved against **that step's** discovery. Pass `sketchStep` (for example the `sketch.publish` step) to qualify sketch-owned labels such as `Outer region`.
- `cad.ref(label, sketchStep?)` is the same, against the latest successful step.
- `cad.target(label, kind?)` returns the typed discovered target, e.g. `cad.target("Point 5", "sketchPoint")` → `{kind, sketchId, pointId}`. Use it where a label is ambiguous across kinds. It throws when the label is missing or ambiguous.
- `cad.regions(sketchStep)` returns the typed region targets owned by one sketch (pass its `sketch.publish` step, or a draft step while drafting). Discovery references are **document-wide**: unfiltered region lists include other sketches.
- `cad.labels(kind?)` lists `[{label, kind}]` currently selectable.
- `cad.topology("face" | "edge" | "vertex")` returns native exact topology joined to selectable labels: `{label, ref, geometryType, definingData, bbox, centroid, bodyLabel}`. Filter it in code, e.g. `cad.topology("face").find(f => f.geometryType === "plane" && Math.abs(f.centroid[2] - 6) < 1e-6).ref`. A plane's `definingData.normal` is not its outward orientation.
- `cad.inspect()` returns compact model facts: variables, features, bodies (label, kind, bounds, face counts by type), the current sketch's solve status, profiles and requirements.
- `cad.last` is the latest successful Step. `step.discovery` is the full discovery (same shape as the CLI's `discovery`), and `step.result` is the full semantic result.
- `cad.schema(operation)` is the same as `--schema <operation>`.
- `cad.log` holds the step summaries of this session.

Ordinary TypeScript works: loops, helper functions, computed coordinates, filtering topology. Return only the data you need; large returns are truncated.

Every executed operation is also appended to `.cadara-trace.jsonl` in the working directory. You don't need to read it.

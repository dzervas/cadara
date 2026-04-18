# OCC Kernel Limitation Tests

These Bun tests are intentionally outside `src`, so the default `bun run test`
command (`bun test src`) does not run them.

Run them explicitly when evaluating whether the current OCC adapter is good
enough for durable topology workflows:

```sh
bun test ignored-tests/occ-kernel-limitations
```

The tests describe behavior expected from a proper topological naming layer.
They are expected to fail with the current implementation because OCC boolean
results are simplified and replacement bodies are re-enumerated with fresh
tokenized topology ids instead of being resolved through durable `TNaming`
history.

export type SolveWork = { kind: "iteration" | "raw"; count: number };

export type SolveSteps<T> = Generator<SolveWork, T, void>;

export function finishSolve<T>(steps: SolveSteps<T>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

// Batch rebuild callbacks are deliberately atomic; this adapter lets them share
// the same rebuild policy without inventing a work checkpoint for a sync solve.
// eslint-disable-next-line require-yield
export function* immediateSolve<T>(run: () => T): SolveSteps<T> {
  return run();
}

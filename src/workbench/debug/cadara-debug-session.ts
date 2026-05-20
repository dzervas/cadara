import type {
  DeveloperDebugSession,
  EditorRuntimeTraceSnapshot,
  WorkbenchDebugState,
} from "@/domain/debug/debug-platform";

interface CadaraDebugLocationLike {
  origin?: string;
  pathname?: string;
  search?: string;
  hash?: string;
}

export function createCadaraDebugSession(input: {
  build: {
    version: string;
    commit: string;
    mode: string | null;
  };
  state: WorkbenchDebugState | null;
  trace: EditorRuntimeTraceSnapshot;
  location?: CadaraDebugLocationLike | null;
  generatedAt?: Date;
}): DeveloperDebugSession {
  const generatedAt = input.generatedAt ?? new Date();

  return {
    generatedAt: generatedAt.toISOString(),
    build: input.build,
    route: {
      origin: input.location?.origin ?? null,
      pathname: input.location?.pathname ?? null,
      search: input.location?.search ?? null,
      hash: input.location?.hash ?? null,
    },
    state: input.state,
    trace: input.trace,
    replay: {
      status: "partial",
      unsupportedSteps: [
        {
          code: "browser-coordination-not-captured",
          message:
            "Browser-coordinated steps are inspectable but not yet exported in a replayable form.",
        },
      ],
    },
  };
}

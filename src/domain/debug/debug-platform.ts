import type { TopologyDebugSummary } from "@/domain/modeling/topology-debug";

export interface WorkbenchDebugRequirement {
  id: string;
  label: string;
  description: string;
  slotCount: number;
}

export interface WorkbenchDebugSelectionDetail {
  label: string;
  kindLabel: string;
  ownerLabel: string;
  relatedLabels: readonly string[];
  targetLabel: string;
}

export interface WorkbenchDebugState {
  activeMode: string;
  machineState: string;
  command: string;
  phase: string;
  selectionCount: number;
  selectionTargets: string;
  revision: string;
  snapshotDiagnosticsCount: number;
  sketchSession: string;
  sketchPlane: string;
  featureSession: string;
  previewState: string;
  selectionFilterLabel: string;
  activeTargetRule: string;
  selectableTargets: readonly string[];
  featureIds: readonly string[];
  previewDiagnostics: string;
  requirements: readonly WorkbenchDebugRequirement[];
  selectionDetail: WorkbenchDebugSelectionDetail;
  hoverTarget: string;
  topologyDebug: TopologyDebugSummary;
  sectionOffset?: number | null;
  sectionRetainedSide?: string | null;
}

export interface EditorRuntimeTraceStateSummary {
  machineState: string;
  mode: string;
  activeCommand: string | null;
  activePhase: string | null;
  revisionId: string | null;
  selectionCount: number;
  pendingSnapshotRequestId: string | null;
}

export interface EditorRuntimeTraceEventSummary {
  type: string;
  requestId: string | null;
}

export interface EditorRuntimeTraceEffectSummary {
  type: string;
  requestId: string | null;
}

export interface EditorRuntimeTraceErrorSummary {
  code: string | null;
  message: string;
  requestId: string | null;
}

export interface EditorRuntimeEventDispatchedTraceEntry {
  kind: "event-dispatched";
  sequence: number;
  at: string;
  event: EditorRuntimeTraceEventSummary;
  state: EditorRuntimeTraceStateSummary;
  emittedEffects: readonly EditorRuntimeTraceEffectSummary[];
}

export interface EditorRuntimeEffectStartedTraceEntry {
  kind: "effect-started";
  sequence: number;
  at: string;
  effect: EditorRuntimeTraceEffectSummary;
  queueDepthAfterStart: number;
}

export interface EditorRuntimeEffectCompletedTraceEntry {
  kind: "effect-completed";
  sequence: number;
  at: string;
  effect: EditorRuntimeTraceEffectSummary;
  completion: EditorRuntimeTraceEventSummary;
  state: EditorRuntimeTraceStateSummary;
  emittedEffects: readonly EditorRuntimeTraceEffectSummary[];
}

export interface EditorRuntimeEffectFailedTraceEntry {
  kind: "effect-failed";
  sequence: number;
  at: string;
  effect: EditorRuntimeTraceEffectSummary;
  error: EditorRuntimeTraceErrorSummary;
  failure: EditorRuntimeTraceEventSummary;
  state: EditorRuntimeTraceStateSummary;
  emittedEffects: readonly EditorRuntimeTraceEffectSummary[];
}

export type EditorRuntimeTraceEntry =
  | EditorRuntimeEventDispatchedTraceEntry
  | EditorRuntimeEffectStartedTraceEntry
  | EditorRuntimeEffectCompletedTraceEntry
  | EditorRuntimeEffectFailedTraceEntry;

export interface EditorRuntimeTraceSnapshot {
  maxEntries: number;
  totalEntries: number;
  droppedEntries: number;
  entries: readonly EditorRuntimeTraceEntry[];
}

export interface DeveloperDebugReplaySupport {
  status: "partial";
  unsupportedSteps: readonly {
    code: string;
    message: string;
  }[];
}

export interface DeveloperDebugSession {
  generatedAt: string;
  build: {
    version: string;
    commit: string;
    mode: string | null;
  };
  route: {
    origin: string | null;
    pathname: string | null;
    search: string | null;
    hash: string | null;
  };
  state: WorkbenchDebugState | null;
  trace: EditorRuntimeTraceSnapshot;
  replay: DeveloperDebugReplaySupport;
}

export interface CadaraDebugNamespace {
  readonly version: 1;
  getState(): WorkbenchDebugState | null;
  getTrace(): EditorRuntimeTraceSnapshot;
  selectTarget(targetId: string): boolean;
  clearSelection(): void;
  refreshDocument(): void;
  exportSession(): DeveloperDebugSession;
}

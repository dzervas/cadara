import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type {
  SemanticDiscovery,
  SemanticFileReceipt,
  SemanticPersistenceReceipt,
  SemanticState,
} from "@/contracts/semantic/schema";

/** Production adapter owns the existing service and editor, never a second state/history store. */
/** Disk boundary only: shared owners neither open pickers nor interpret terminal paths. */
export interface NativeDocumentFileIO {
  read(path: string): Promise<string>;
  write(
    path: string,
    text: string,
  ): Promise<{
    kind: "written" | "failed";
    bytesWritten: number;
    diagnostics: readonly ModelingDiagnostic[];
  }>;
}

export interface SemanticDocumentMutation {
  state: SemanticState | null;
  failure?: "execution" | "file" | "persistence";
  rejected?: string;
  persistence: SemanticPersistenceReceipt;
  diagnostics: readonly ModelingDiagnostic[];
}

export interface SemanticDocumentPort {
  featureReplay?(command: import("@/contracts/semantic/schema").SemanticFeatureReplayCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  bodyOperation?(command: import("@/contracts/semantic/schema").SemanticBodyOperationCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  bodyBoolean?(command: import("@/contracts/semantic/schema").SemanticBodyBooleanCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  loft?(command: import("@/contracts/semantic/schema").SemanticLoftCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  sweep?(command: import("@/contracts/semantic/schema").SemanticSweepCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  hole?(command: import("@/contracts/semantic/schema").SemanticHoleCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  shellThicken?(command: import("@/contracts/semantic/schema").SemanticShellThickenCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  edgeTreatment?(command: import("@/contracts/semantic/schema").SemanticEdgeTreatmentCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  plane?(command: import("@/contracts/semantic/schema").SemanticPlaneCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  featureLifecycle?(command: import("@/contracts/semantic/schema").SemanticFeatureLifecycleCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  variable?(command: import("@/contracts/semantic/schema").SemanticVariableCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  export?(command: import("@/contracts/semantic/schema").SemanticExportCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  history?(command: import("@/contracts/semantic/schema").SemanticHistoryCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  revolve?(command: import("@/contracts/semantic/schema").SemanticRevolveCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  extrude?(command: import("@/contracts/semantic/schema").SemanticExtrudeCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  sketch?(command: import("@/contracts/semantic/schema").SemanticSketchCommand): Promise<import("@/contracts/semantic/schema").SemanticResult>;
  initialize(): Promise<
    | { kind: "ready"; discovery: SemanticDiscovery }
    | { kind: "failed"; diagnostics: readonly ModelingDiagnostic[] }
  >;
  create(input: { commandId: string; label: string }): Promise<{
    state: SemanticState | null;
    failure?: "execution";
    persistence: SemanticPersistenceReceipt;
    diagnostics: readonly ModelingDiagnostic[];
  }>;
  /** Fetch and hand off an authoritative snapshot; errors remain observable. */
  inspect(input: { commandId: string }): Promise<{
    discovery: SemanticDiscovery;
    diagnostics: readonly ModelingDiagnostic[];
  }>;
  /** Optional family capability; paths are opaque adapter inputs, not picker policy. */
  nativeFiles?: {
    open(input: {
      commandId: string;
      path: string;
      currentState: SemanticState;
    }): Promise<SemanticDocumentMutation>;
    rename(input: {
      commandId: string;
      label: string;
      currentState: SemanticState;
    }): Promise<SemanticDocumentMutation>;
    save(input: {
      commandId: string;
      path: string;
      state: SemanticState;
    }): Promise<{
      file: SemanticFileReceipt;
      persistence: SemanticPersistenceReceipt;
      failure?: "execution";
      diagnostics: readonly ModelingDiagnostic[];
    }>;
  };
  drain(): Promise<void>;
  release(): Promise<void>;
}

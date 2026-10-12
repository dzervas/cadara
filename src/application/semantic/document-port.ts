import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type {
  SemanticDiscovery,
  SemanticPersistenceReceipt,
  SemanticState,
} from "@/contracts/semantic/schema";

/** Production adapter owns the existing service and editor, never a second state/history store. */
export interface SemanticDocumentPort {
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
  drain(): Promise<void>;
  release(): Promise<void>;
}

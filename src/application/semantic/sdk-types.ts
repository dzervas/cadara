import type { SemanticCommand } from "@/contracts/semantic/schema";
import type { SelectableCommand } from "./target-inputs";
import type { SemanticHandle } from "./sdk";

export type OperationId = SemanticCommand["operation"];
/** Distribute over arms AND their operation literals (undo/redo and svg/dxf share arms). */
type CommandFor<K extends OperationId, T = SelectableCommand> = T extends { operation: infer O }
  ? K extends O ? Omit<T, "operation"> & { operation: K } : never
  : never;
type Fields<T> = T extends unknown
  ? Omit<T, "version" | "commandId" | "basis" | "draft" | "operation" | "intent"> &
    (T extends { intent: infer I } ? { intent?: I } : unknown)
  : never;
export type OperationFields<K extends OperationId> = Fields<CommandFor<K>>;
export type OperationOptions = { signal?: AbortSignal };
export type OperationCall<K extends OperationId> = (
  fields: OperationFields<K>, options?: OperationOptions,
) => Promise<SemanticHandle>;
type Heads<P extends string> = P extends `${infer Head}.${string}` ? Head : P;
type OperationsAt<Paths extends string, Prefix extends string = ""> = {
  [K in Heads<Paths>]: `${Prefix}${K}` extends OperationId
    ? OperationCall<`${Prefix}${K}`>
    : OperationsAt<Paths extends `${K}.${infer Rest}` ? Rest : never, `${Prefix}${K}.`>;
};
export type Operations = OperationsAt<OperationId>;
export type RecipeTrace = { version: 1; operations: readonly (SelectableCommand & { as?: string })[] };

/** Importable Bun/headless SDK entry. Importing does not open a document or run the CLI. */
import { createHeadlessSessionFactory } from "@/composition/headless";
import { openSemanticDocument, type SemanticDocument } from "@/application/semantic/sdk";

export { SemanticDocument, SemanticHandle, SemanticOperationError, SemanticInitializationError, openSemanticDocument } from "@/application/semantic/sdk";
export { SemanticTraceError } from "@/application/semantic/sdk-trace";
export { SelectionError } from "@/application/semantic/selection-error";
export type { OperationAttempt, ProbeEdit } from "@/application/semantic/sdk";
export type { SemanticSession, SemanticSessionFactory, SemanticCloseResult } from "@/application/semantic/ports";
export type { OperationFields, OperationId, OperationOptions, Operations, RecipeTrace } from "@/application/semantic/sdk-types";
export type { SemanticCommand, SemanticResult, SemanticDiscovery, SemanticReferenceOwner } from "@/contracts/semantic/schema";
export type { DurableRef } from "@/contracts/shared/references";
export type { Inspection } from "@/application/semantic/sdk-queries";

/** Create an isolated native document, or open one saved .cadara file. Caller must await close(). */
export async function openCadara(options: { label?: string; path?: string } = {}): Promise<SemanticDocument> {
  const document = await openSemanticDocument(createHeadlessSessionFactory());
  try {
    if (options.path) await document.ops.document.open({ path: options.path });
    else await document.ops.document.create({ label: options.label ?? "Untitled" });
    return document;
  } catch (error) {
    const cleanup = await document.close();
    if (cleanup.kind !== "closed") throw new AggregateError([error, cleanup], "Document setup and cleanup failed");
    throw error;
  }
}

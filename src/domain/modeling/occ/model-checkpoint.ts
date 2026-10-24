import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { GeometryAssetResolver } from "@/contracts/modeling/adapter";
import type { DocumentId } from "@/contracts/shared/ids";
import { hashGeometryAssetBytes } from "@/domain/modeling/geometry-asset-store";
import type {
  ModelCheckpoint,
  ModelCheckpointStore,
} from "@/domain/modeling/model-checkpoint-store";
import {
  OCC_AUTHORING_CHECKPOINT_FORMAT,
  OccCheckpointInvalidError,
  OccCheckpointUnsupportedError,
  decodeOccAuthoringCheckpoint,
  encodeOccAuthoringCheckpoint,
} from "@/domain/modeling/occ/authoring-checkpoint";
import type { OccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  OccShapeSetCheckpointUnavailableError,
  OccShapeSetCheckpointWriteError,
} from "@/domain/modeling/occ/shape-set-checkpoint";

/**
 * cadara-3sq.6: how the production OCC adapter consults and fills a
 * ModelCheckpointStore around one complete document open. The adapter owns
 * the restore itself; this module owns cache identity, isolated hydration and
 * publication.
 */

const CHECKPOINT_DOCUMENT_ID_PLACEHOLDER = "doc_checkpoint";

/** The state's authored document as text, independent of the session document id. */
function exportCheckpointDocument(
  state: OccAuthoringState,
  exported: AuthoredModelDocument,
) {
  const text = JSON.stringify({
    ...exported,
    documentId: CHECKPOINT_DOCUMENT_ID_PLACEHOLDER,
  });
  if (text.includes(state.documentId)) {
    throw new OccCheckpointUnsupportedError(
      "the authored document embeds the session document id.",
    );
  }
  return text;
}

/**
 * The cache identity of one complete open: a digest of every input the
 * restore evaluates. That is the whole validated document content (only the
 * per-session document id is factored out), the restore diagnostics, every
 * geometry asset's actual bytes, the adapter's evaluation settings, the
 * checkpoint format and the store's build/runtime compatibility material.
 * The document is the exact value the cold path evaluates, so equal keys mean
 * equal evaluation inputs. Inputs that cannot be fingerprinted here make the
 * open uncacheable.
 *
 * The key hashes that parsed document rather than the file's raw bytes on
 * purpose: the evaluator never sees the bytes, only this value (normalised by
 * the evaluator's own parser, not by a cache-specific canonicalisation), plus
 * the asset bytes and settings hashed beside it and code the build fingerprint
 * covers. Two inputs that parse to the same document evaluate identically;
 * every content difference the evaluator can observe changes the key.
 */
export async function createModelCheckpointKey(
  store: ModelCheckpointStore,
  input: {
    document: AuthoredModelDocument;
    diagnostics: readonly ModelingDiagnostic[];
    assetBlobs: ReadonlyMap<string, Uint8Array>;
    /** Baked bodies resolve their assets lazily inside evaluation. */
    hasBakedBodyAssets: boolean;
    evaluationSettings: unknown;
  },
): Promise<{ key: string } | { bypass: string }> {
  if (input.hasBakedBodyAssets) return { bypass: "baked-body-assets" };
  const assets: [string, string][] = [];
  for (const record of input.document.assets.records) {
    const bytes = input.assetBlobs.get(record.hash);
    if (!bytes) return { bypass: "unresolved-geometry-asset" };
    assets.push([record.hash, await hashGeometryAssetBytes(bytes)]);
  }
  const compatibility = await store.compatibility();
  if (compatibility === null) return { bypass: "unfingerprinted-runtime" };
  const material = JSON.stringify({
    format: OCC_AUTHORING_CHECKPOINT_FORMAT,
    compatibility,
    evaluationSettings: input.evaluationSettings,
    document: {
      ...input.document,
      documentId: CHECKPOINT_DOCUMENT_ID_PLACEHOLDER,
    },
    diagnostics: input.diagnostics,
    assets,
  });
  const digest = await hashGeometryAssetBytes(
    new TextEncoder().encode(material),
  );
  return { key: digest.slice("sha256:".length) };
}

/**
 * Authored inputs that an open evaluates but never rewrites. A candidate must
 * export exactly these values of the document being opened, so an entry is
 * bound to that document by its content, not only by the key it is stored
 * under. Derived fields (solved sketches, topology lineage, body appearances)
 * are covered by the entry's own recorded export.
 */
const AUTHORED_INPUT_FIELDS = [
  "name",
  "revisionId",
  "settings",
  "variables",
  "features",
  "featureOrder",
  "historyOrder",
  "cursor",
  "bodyLabels",
  "assets",
  "embeddedBinaryAssets",
] as const satisfies readonly (keyof AuthoredModelDocument)[];

function differingAuthoredInputs(
  exported: AuthoredModelDocument,
  document: AuthoredModelDocument,
) {
  return AUTHORED_INPUT_FIELDS.filter(
    (field) =>
      JSON.stringify(stableJsonValue(exported[field])) !==
      JSON.stringify(stableJsonValue(document[field])),
  );
}

/**
 * Decodes a stored checkpoint for `document` into an isolated candidate and
 * returns it only after it re-exports the recorded document and the authored
 * inputs of `document`. Every rejected candidate is released (through
 * `release`, the adapter's ownership graph) before the caller runs the cold
 * path.
 */
export async function hydrateModelCheckpoint(input: {
  store: ModelCheckpointStore;
  key: string;
  oc: OpenCascadeInstance;
  document: AuthoredModelDocument & { documentId: DocumentId };
  assetResolver: GeometryAssetResolver | undefined;
  exportDocument: (state: OccAuthoringState) => AuthoredModelDocument;
  release: (candidate: OccAuthoringState) => void;
}): Promise<OccAuthoringState | null> {
  const { store, key } = input;
  const checkpoint = await store.read(key);
  if (!checkpoint) return null;
  let candidate: OccAuthoringState;
  try {
    candidate = decodeOccAuthoringCheckpoint(input.oc, checkpoint, {
      documentId: input.document.documentId,
      assetResolver: input.assetResolver,
    });
  } catch (error) {
    if (
      !(error instanceof OccCheckpointInvalidError) &&
      !(error instanceof OccShapeSetCheckpointUnavailableError)
    ) {
      throw error;
    }
    store.report({ kind: "degraded", key, reason: error.message });
    return null;
  }
  let mismatch: string | null = null;
  try {
    const exported = input.exportDocument(candidate);
    const differing = differingAuthoredInputs(exported, input.document);
    if (differing.length) {
      mismatch = `the decoded state is another document (${differing.join(", ")} differ).`;
    } else if (
      exportCheckpointDocument(candidate, exported) !==
      checkpoint.exportedDocument
    ) {
      mismatch = "the decoded state does not export its recorded document.";
    }
  } catch (error) {
    // Untrusted data can decode to a state the exporter cannot read.
    mismatch = `the decoded state cannot be exported (${error instanceof Error ? error.message : String(error)}).`;
  }
  if (mismatch) {
    input.release(candidate);
    store.report({
      kind: "degraded",
      key,
      reason: `occ-checkpoint-invalid: ${mismatch}`,
    });
    return null;
  }
  return candidate;
}

/** Publishes only a complete, fully evaluated state; anything else stays uncached. */
export async function publishModelCheckpoint(input: {
  store: ModelCheckpointStore;
  key: string;
  state: OccAuthoringState;
  /** The rebuild stopped early or deferred features. */
  partial: boolean;
  exportDocument: (state: OccAuthoringState) => AuthoredModelDocument;
}) {
  const { store, key, state } = input;
  if (
    input.partial ||
    state.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    store.report({ kind: "bypass", reason: "incomplete-evaluation" });
    return;
  }
  let checkpoint: ModelCheckpoint;
  try {
    const encoded = encodeOccAuthoringCheckpoint(state);
    checkpoint = {
      graph: encoded.graph,
      shapes: encoded.shapes,
      brep: encoded.brep,
      exportedDocument: exportCheckpointDocument(
        state,
        input.exportDocument(state),
      ),
    };
  } catch (error) {
    if (error instanceof OccCheckpointUnsupportedError) {
      store.report({ kind: "bypass", reason: error.message });
      return;
    }
    if (
      error instanceof OccShapeSetCheckpointWriteError ||
      error instanceof OccShapeSetCheckpointUnavailableError
    ) {
      store.report({ kind: "degraded", key, reason: error.message });
      return;
    }
    throw error;
  }
  await store.publish(key, checkpoint);
}

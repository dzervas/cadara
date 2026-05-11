import { z } from "zod";

import type {
  CadaraExportOptions,
  DocumentExportRequest,
  DocumentExportResult,
} from "@/contracts/modeling/export";
import { durableRefSchema } from "@/contracts/shared/references.runtime-schema";
import {
  contractVersionSchema,
  revisionIdSchema,
  stringSchema,
} from "@/contracts/shared/runtime-schema";

const cadaraExportOptionsBaseSchema = z
  .object({
    pretty: z.boolean(),
  })
  .strict();

export const cadaraExportOptionsSchema =
  cadaraExportOptionsBaseSchema.transform(
    (value) => value as CadaraExportOptions,
  );

export function getDefaultCadaraExportOptions(): CadaraExportOptions {
  return { pretty: true };
}

const baseDocumentExportRequestSchema = z.object({
  contractVersion: contractVersionSchema,
  documentId: stringSchema,
  baseRevisionId: revisionIdSchema,
  target: durableRefSchema,
  targetLabel: stringSchema,
});

export const documentExportRequestSchema = baseDocumentExportRequestSchema
  .extend({
    format: z.string(),
    options: z.unknown(),
  })
  .transform((value) => value as DocumentExportRequest);

const documentExportDiagnosticSchema = z.object({
  code: stringSchema,
  severity: z.union([
    z.literal("info"),
    z.literal("warning"),
    z.literal("error"),
  ]),
  message: stringSchema,
  target: durableRefSchema.nullable(),
});

export const documentExportResultSchema = z
  .discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      format: z.string(),
      filename: stringSchema,
      extension: stringSchema,
      mimeType: stringSchema,
      payload: z.union([z.string(), z.instanceof(Uint8Array)]),
      diagnostics: z.array(documentExportDiagnosticSchema),
    }),
    z.object({
      ok: z.literal(false),
      format: z.string(),
      diagnostics: z.array(documentExportDiagnosticSchema),
    }),
  ])
  .transform((value) => value as DocumentExportResult);

import { z } from "zod";

import type {
  RenderExport,
  RenderableEntityRecord,
} from "@/contracts/render/schema";
import { durableRefSchema } from "@/contracts/shared/references.runtime-schema";
import {
  bodyIdSchema,
  featureIdSchema,
  literalVersionSchema,
  pickIdSchema,
  point3dSchema,
  positiveNumberSchema,
  renderableIdSchema,
} from "@/contracts/shared/runtime-schema";
import type { RenderExportSchemaVersion } from "@/contracts/shared/versioning";
import { RENDER_EXPORT_SCHEMA_VERSION } from "@/contracts/shared/versioning";

export const renderExportSchemaVersionSchema =
  literalVersionSchema<RenderExportSchemaVersion>(
    RENDER_EXPORT_SCHEMA_VERSION,
    "schemaVersion",
    "Unsupported render export schema version",
  );

const renderBindingSchema = z.object({
  pickId: pickIdSchema,
  pickPriority: z.number(),
  target: durableRefSchema,
  topology: z
    .union([z.literal("face"), z.literal("edge"), z.literal("vertex")])
    .nullable(),
  semanticClass: z.union([
    z.literal("bodyFace"),
    z.literal("planarFace"),
    z.literal("featureEdge"),
    z.literal("featureVertex"),
    z.literal("region"),
    z.literal("sketchCurve"),
    z.literal("sketchPoint"),
    z.literal("construction"),
  ]),
});

const renderGeometrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mesh"),
    vertexPositions: z.array(point3dSchema),
    vertexNormals: z.array(point3dSchema).nullable(),
    triangleIndices: z.array(
      z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    ),
  }),
  z.object({
    kind: z.literal("polyline"),
    points: z.array(point3dSchema),
    isClosed: z.boolean(),
  }),
  z.object({
    kind: z.literal("marker"),
    position: point3dSchema,
    displayRadius: positiveNumberSchema(
      "Render marker radius must be positive.",
    ),
  }),
]);

const renderableEntityRecordSchema = z
  .object({
    id: renderableIdSchema,
    label: z.string(),
    ownerBodyId: bodyIdSchema.nullable(),
    ownerFeatureId: featureIdSchema.nullable(),
    binding: renderBindingSchema,
    geometry: renderGeometrySchema,
  })
  .transform((value) => value as RenderableEntityRecord);

export const renderExportSchema = z
  .object({
    schemaVersion: renderExportSchemaVersionSchema,
    records: z.array(renderableEntityRecordSchema),
  })
  .transform((value) => value as RenderExport);

import { z } from "zod";

import { stringSchema } from "@/contracts/shared/runtime-schema";
import type { EmbeddedBinaryAssetRecord } from "@/contracts/modeling/embedded-binary-assets";

export const embeddedBinaryAssetRecordSchema = z
  .object({
    assetId: stringSchema.min(1, "Embedded binary asset ID must not be empty."),
    hash: stringSchema.regex(
      /^sha256:[a-f0-9]{64}$/,
      "Embedded binary asset hash must be a sha256:<hex> content hash.",
    ),
    byteLength: z.number().int().nonnegative(),
    mediaType: stringSchema.min(
      1,
      "Embedded binary asset media type must not be empty.",
    ),
    fileName: stringSchema.min(1).optional(),
  })
  .strict()
  .transform((value) => value as EmbeddedBinaryAssetRecord);

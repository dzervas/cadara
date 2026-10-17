import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";
import { prepareReferenceImagePayload } from "@/domain/reference-image/raster";

export async function readReferenceImagePayload(
  file: File,
): Promise<ReferenceImagePayload> {
  return prepareReferenceImagePayload({
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    mediaType: file.type,
  });
}

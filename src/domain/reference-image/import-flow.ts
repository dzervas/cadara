import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";
import {
  encodeBytesToBase64,
  inferReferenceImageMediaType,
  readRasterImageDimensions,
} from "@/domain/reference-image/raster";

export async function readReferenceImagePayload(
  file: File,
): Promise<ReferenceImagePayload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { width, height } = readRasterImageDimensions(bytes);
  const mediaType = file.type.trim() || inferReferenceImageMediaType(file.name);

  if (!mediaType) {
    throw new Error(`Unsupported reference image type for ${file.name}.`);
  }

  return {
    mediaType,
    fileName: file.name.trim() || undefined,
    pixelWidth: width,
    pixelHeight: height,
    base64Data: encodeBytesToBase64(bytes),
  };
}

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ReferenceImageFiles } from "@/application/semantic/reference-image-files";
import { prepareReferenceImagePayload } from "@/domain/reference-image/raster";

export const filesystemReferenceImageFiles: ReferenceImageFiles = {
  async read(path) {
    return prepareReferenceImagePayload({ bytes: await readFile(path), fileName: basename(path) });
  },
};

import type { ReferenceImagePayload } from "@/contracts/reference-image/schema";

/** Runtime adapter owns byte acquisition and existing raster metadata validation. */
export interface ReferenceImageFiles {
  read(path: string): Promise<ReferenceImagePayload>;
}

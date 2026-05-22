import typia from "typia";

import type { RenderExport } from "@/contracts/render/schema";
import { requireContract } from "@/contracts/shared/validation";

const renderExportValidator = typia.createValidateEquals<RenderExport>();

export function requireRenderExport(value: unknown): RenderExport {
  return requireContract(renderExportValidator, value, "Render export");
}

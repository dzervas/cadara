import typia from "typia";
import type { ModelingFeatureKind } from "@/contracts/modeling/schema";
import type { SemanticCommand } from "@/contracts/semantic/schema";

/**
 * JSON Schemas generated at build time from the closed contract types (the
 * same types the command validators are generated from). JSDoc descriptions
 * and `@x-unit` tags on contract fields are carried into the schemas.
 */
export const contractJsonSchemas = typia.json.schemas<[SemanticCommand, ModelingFeatureKind], "3.1">();

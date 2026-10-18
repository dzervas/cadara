import { contractJsonSchemas } from "./catalog.runtime-schema";
import type { SemanticCommand } from "./schema";

type Schema = { $ref?: string; oneOf?: Schema[]; anyOf?: Schema[]; properties?: Record<string, Schema>; required?: string[]; const?: unknown; enum?: unknown[] };
const components = contractJsonSchemas.components.schemas as Record<string, Schema>;
function expand(schema: Schema): Schema[] {
  if (schema.$ref) return expand(components[schema.$ref.split("/").at(-1)!]!);
  const union = schema.oneOf ?? schema.anyOf;
  return union ? union.flatMap(expand) : [schema];
}
/** Generated runtime counterpart of SemanticCommand's closed operation union. */
export const semanticOperationMetadata = new Map<SemanticCommand["operation"], ReadonlySet<string>>();
for (const variant of expand(components.SemanticCommand!)) {
  for (const operationSchema of expand(variant.properties!.operation!)) {
    for (const operation of operationSchema.enum ?? [operationSchema.const]) {
      semanticOperationMetadata.set(operation as SemanticCommand["operation"], new Set(variant.required));
    }
  }
}

export const semanticFeatureKinds = new Set(
  expand(contractJsonSchemas.schemas[1] as Schema).flatMap((schema) => schema.enum ?? [schema.const]),
);

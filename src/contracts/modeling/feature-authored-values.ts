import {
  ensureLiteralAuthoredValue,
  type FeatureValueKindDescriptor,
} from "@/contracts/modeling/authored-values";
import {
  getFeatureValueKindDescriptor,
  LOFT_ADVANCED_OPTION_DESCRIPTORS,
  type AdvancedFeatureOptionDescriptor,
  type AdvancedFeatureScalarOptionDescriptor,
} from "@/contracts/modeling/advanced-solid";
import type { FeatureDefinition } from "@/contracts/modeling/schema";

type MutableRecord = Record<string, unknown>;

const BOOLEAN_OPERATION_OPTIONS = [
  "newBody",
  "join",
  "cut",
  "intersect",
] as const;
const ADVANCED_OPERATION_INTENT_OPTIONS = [
  "create",
  "add",
  "subtract",
  "intersect",
] as const;

export interface FeatureValueExpressionFieldDescriptor {
  path: readonly (string | number)[];
  label: string;
  valueKind: FeatureValueKindDescriptor;
}

export function normalizeFeatureDefinitionAuthoredValues(
  definition: FeatureDefinition,
): FeatureDefinition {
  const normalized = structuredClone(definition) as FeatureDefinition;

  for (const field of getFeatureValueExpressionFields(normalized)) {
    const value = getPathValue(
      normalized as unknown as MutableRecord,
      field.path,
    );
    if (value !== undefined) {
      setPathValue(
        normalized as unknown as MutableRecord,
        field.path,
        ensureLiteralAuthoredValue(value),
      );
    }
  }

  return normalized;
}

export function getFeatureValueExpressionFields(
  definition: FeatureDefinition,
): FeatureValueExpressionFieldDescriptor[] {
  switch (definition.kind) {
    case "extrude":
      return [
        {
          path: ["parameters", "extent", "end", "distance"],
          label: "Extrude depth",
          valueKind: { kind: "positiveNumber" },
        },
        {
          path: ["parameters", "extent", "end", "draftAngle"],
          label: "Extrude draft angle",
          valueKind: { kind: "angle" },
        },
        {
          path: ["parameters", "extent", "end", "offset", "distance"],
          label: "Extrude up-to offset",
          valueKind: { kind: "finiteNumber" },
        },
        {
          path: ["parameters", "extent", "firstEnd", "distance"],
          label: "Extrude first depth",
          valueKind: { kind: "positiveNumber" },
        },
        {
          path: ["parameters", "extent", "firstEnd", "draftAngle"],
          label: "Extrude first draft angle",
          valueKind: { kind: "angle" },
        },
        {
          path: ["parameters", "extent", "firstEnd", "offset", "distance"],
          label: "Extrude first up-to offset",
          valueKind: { kind: "finiteNumber" },
        },
        {
          path: ["parameters", "extent", "secondEnd", "distance"],
          label: "Extrude second depth",
          valueKind: { kind: "positiveNumber" },
        },
        {
          path: ["parameters", "extent", "secondEnd", "draftAngle"],
          label: "Extrude second draft angle",
          valueKind: { kind: "angle" },
        },
        {
          path: ["parameters", "extent", "secondEnd", "offset", "distance"],
          label: "Extrude second up-to offset",
          valueKind: { kind: "finiteNumber" },
        },
        {
          path: ["parameters", "operation"],
          label: "Extrude operation",
          valueKind: { kind: "enumString", options: BOOLEAN_OPERATION_OPTIONS },
        },
      ];
    case "fillet":
      return [
        {
          path: ["parameters", "radius"],
          label: "Fillet radius",
          valueKind: { kind: "positiveNumber" },
        },
      ];
    case "revolve":
      return [
        {
          path: ["parameters", "startAngle"],
          label: "Revolve start angle",
          valueKind: { kind: "angle" },
        },
        {
          path: ["parameters", "extent", "end", "angle"],
          label: "Revolve angle",
          valueKind: { kind: "positiveNumber" },
        },
        {
          path: ["parameters", "extent", "end", "offset", "angle"],
          label: "Revolve up-to offset",
          valueKind: { kind: "angle" },
        },
        {
          path: ["parameters", "extent", "firstEnd", "angle"],
          label: "Revolve first angle",
          valueKind: { kind: "positiveNumber" },
        },
        {
          path: ["parameters", "extent", "firstEnd", "offset", "angle"],
          label: "Revolve first up-to offset",
          valueKind: { kind: "angle" },
        },
        {
          path: ["parameters", "extent", "secondEnd", "angle"],
          label: "Revolve second angle",
          valueKind: { kind: "positiveNumber" },
        },
        {
          path: ["parameters", "extent", "secondEnd", "offset", "angle"],
          label: "Revolve second up-to offset",
          valueKind: { kind: "angle" },
        },
        {
          path: ["parameters", "operation"],
          label: "Revolve operation",
          valueKind: { kind: "enumString", options: BOOLEAN_OPERATION_OPTIONS },
        },
      ];
    case "shell":
      return [
        {
          path: ["parameters", "thickness"],
          label: "Shell thickness",
          valueKind: { kind: "positiveNumber" },
        },
        {
          path: ["parameters", "operation"],
          label: "Shell operation",
          valueKind: { kind: "enumString", options: BOOLEAN_OPERATION_OPTIONS },
        },
      ];
    case "chamfer":
      return [
        {
          path: ["parameters", "options", "distance"],
          label: "Chamfer distance",
          valueKind: { kind: "positiveNumber" },
        },
      ];
    case "thicken":
      return [
        {
          path: ["parameters", "operationIntent"],
          label: "Thicken operation intent",
          valueKind: {
            kind: "enumString",
            options: ADVANCED_OPERATION_INTENT_OPTIONS,
          },
        },
        {
          path: ["parameters", "options", "thickness"],
          label: "Thicken thickness",
          valueKind: { kind: "positiveNumber" },
        },
        {
          path: ["parameters", "options", "side"],
          label: "Thicken side",
          valueKind: { kind: "enumString", options: ["oneSide", "symmetric"] },
        },
      ];
    case "combine":
      return [
        {
          path: ["parameters", "operationIntent"],
          label: "Combine operation intent",
          valueKind: {
            kind: "enumString",
            options: ["add", "subtract", "intersect"],
          },
        },
      ];
    case "mirror":
      return [
        {
          path: ["parameters", "options", "copy"],
          label: "Mirror copy",
          valueKind: { kind: "boolean" },
        },
      ];
    case "transform":
      return [
        {
          path: ["parameters", "options", "distance"],
          label: "Transform distance",
          valueKind: { kind: "positiveNumber" },
        },
      ];
    case "sweep":
      return [
        {
          path: ["parameters", "operationIntent"],
          label: "Sweep operation intent",
          valueKind: {
            kind: "enumString",
            options: ADVANCED_OPERATION_INTENT_OPTIONS,
          },
        },
      ];
    case "loft":
      return [
        {
          path: ["parameters", "operationIntent"],
          label: "Loft operation intent",
          valueKind: {
            kind: "enumString",
            options: ADVANCED_OPERATION_INTENT_OPTIONS,
          },
        },
        ...getAdvancedFeatureOptionExpressionFields(
          ["parameters", "options"],
          LOFT_ADVANCED_OPTION_DESCRIPTORS,
        ),
      ];
    case "plane":
    case "split":
    case "deleteSolid":
      return [];
    default:
      return [];
  }
}

export function getAdvancedFeatureOptionExpressionFields(
  basePath: readonly (string | number)[],
  descriptors: readonly AdvancedFeatureOptionDescriptor[],
): FeatureValueExpressionFieldDescriptor[] {
  return descriptors.flatMap((descriptor) =>
    getAdvancedFeatureOptionExpressionField(basePath, descriptor),
  );
}

function getAdvancedFeatureOptionExpressionField(
  basePath: readonly (string | number)[],
  descriptor: AdvancedFeatureOptionDescriptor,
): FeatureValueExpressionFieldDescriptor[] {
  if (descriptor.valueKind === "group") {
    return getAdvancedFeatureOptionExpressionFields(
      [...basePath, descriptor.key],
      descriptor.options,
    );
  }

  if (descriptor.valueKind === "discriminatedGroup") {
    return [
      {
        path: [...basePath, descriptor.discriminantKey],
        label: descriptor.label,
        valueKind: {
          kind: "enumString",
          options: descriptor.variants.map((variant) => variant.value),
        },
      },
      ...descriptor.variants.flatMap((variant) =>
        getAdvancedFeatureOptionExpressionFields(basePath, variant.options),
      ),
    ];
  }

  return [getScalarAdvancedFeatureOptionExpressionField(basePath, descriptor)];
}

function getScalarAdvancedFeatureOptionExpressionField(
  basePath: readonly (string | number)[],
  descriptor: AdvancedFeatureScalarOptionDescriptor,
): FeatureValueExpressionFieldDescriptor {
  return {
    path: [...basePath, descriptor.key],
    label: descriptor.label,
    valueKind: getFeatureValueKindDescriptor(descriptor),
  };
}

function getPathValue(
  value: MutableRecord,
  path: readonly (string | number)[],
) {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    current = (current as MutableRecord)[segment];
  }

  return current;
}

function setPathValue(
  value: MutableRecord,
  path: readonly (string | number)[],
  nextValue: unknown,
) {
  let current: MutableRecord = value;
  for (const segment of path.slice(0, -1)) {
    const child = current[segment];
    if (typeof child !== "object" || child === null) {
      return;
    }

    current = child as MutableRecord;
  }

  const last = path.at(-1);
  if (last !== undefined) {
    current[last] = nextValue;
  }
}

import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  HOLE_OPTION_DESCRIPTORS,
  validateAdvancedSolidFeatureDefinition,
  type HoleAdvancedOptions,
  type HoleStyle,
  type HoleTermination,
  type HoleDirection,
} from "@/contracts/modeling/advanced-solid";
import type { MaybeAuthoredValue } from "@/contracts/modeling/authored-values";
import type {
  FeatureAuthoringDefinition,
  HoleFeatureParameterDraft,
} from "@/core/feature-authoring/definition";
import {
  createSelectionFilterForRequirement,
  holeSelectionFilter,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptAuthoredPatch,
  appendUniqueTarget,
  asBodyRef,
  asSketchPointRef,
  authoredDefinitionValue,
  authoredNumberFormValue,
  authoredNumberLiteral,
  authoredStringLiteral,
  createMissingInputDiagnostic,
  expressionCapableAuthoredValue,
  filterTargets,
  isFiniteAuthoredNumber,
  isPositiveAuthoredNumber,
} from "@/core/feature-authoring/features/shared";

export const holeParticipants = [
  {
    role: "location",
    label: "Hole locations",
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ["sketchPoint"],
  },
  {
    role: "body",
    label: "Body targets",
    required: true,
    cardinality: { min: 1, max: null },
    acceptedKinds: ["body"],
  },
] as const;

export const holeOptions = HOLE_OPTION_DESCRIPTORS;

function holeStyle(options: HoleAdvancedOptions): HoleStyle {
  return authoredStringLiteral(options.style ?? "simple", "simple");
}

function holeTermination(options: HoleAdvancedOptions): HoleTermination {
  return authoredStringLiteral(options.termination ?? "blind", "blind");
}

function holeDirection(options: HoleAdvancedOptions): HoleDirection {
  return authoredStringLiteral(options.direction ?? "forward", "forward");
}

function normalizeHoleOptions(
  options: Record<string, unknown> | undefined,
): HoleAdvancedOptions {
  const style = authoredStringLiteral(
    (options?.style as HoleAdvancedOptions["style"]) ?? "simple",
    "simple",
  );
  const base = {
    mainDiameter: (options?.mainDiameter ?? 1) as HoleAdvancedOptions["mainDiameter"],
    direction: (options?.direction ?? "forward") as HoleAdvancedOptions["direction"],
    termination: (options?.termination ?? "blind") as HoleAdvancedOptions["termination"],
    depth: (options?.depth ?? 5) as HoleAdvancedOptions["depth"],
  };

  if (style === "counterbore") {
    return {
      ...base,
      style,
      counterboreDiameter: (options?.counterboreDiameter ?? 2) as Extract<
        HoleAdvancedOptions,
        { style: unknown; counterboreDiameter: unknown }
      >["counterboreDiameter"],
      counterboreDepth: (options?.counterboreDepth ?? 1) as Extract<
        HoleAdvancedOptions,
        { style: unknown; counterboreDepth: unknown }
      >["counterboreDepth"],
    };
  }

  if (style === "countersink") {
    return {
      ...base,
      style,
      countersinkDiameter: (options?.countersinkDiameter ?? 2) as Extract<
        HoleAdvancedOptions,
        { style: unknown; countersinkDiameter: unknown }
      >["countersinkDiameter"],
      countersinkAngleDegrees: (options?.countersinkAngleDegrees ?? 90) as Extract<
        HoleAdvancedOptions,
        { style: unknown; countersinkAngleDegrees: unknown }
      >["countersinkAngleDegrees"],
    };
  }

  return { ...base, style: "simple" };
}

function buildHoleOptions(options: HoleAdvancedOptions): Record<string, unknown> {
  const style = holeStyle(options);
  const termination = holeTermination(options);
  const base = {
    style: authoredDefinitionValue(style, "simple"),
    mainDiameter: authoredDefinitionValue(options.mainDiameter ?? 1, 1),
    direction: authoredDefinitionValue(holeDirection(options), "forward"),
    termination: authoredDefinitionValue(termination, "blind"),
    ...(termination === "blind"
      ? { depth: authoredDefinitionValue(options.depth ?? 5, 5) }
      : {}),
  };

  if (style === "counterbore") {
    return {
      ...base,
      counterboreDiameter: authoredDefinitionValue(
        options.counterboreDiameter ?? 2,
        2,
      ),
      counterboreDepth: authoredDefinitionValue(options.counterboreDepth ?? 1, 1),
    };
  }

  if (style === "countersink") {
    return {
      ...base,
      countersinkDiameter: authoredDefinitionValue(
        options.countersinkDiameter ?? 2,
        2,
      ),
      countersinkAngleDegrees: authoredDefinitionValue(
        options.countersinkAngleDegrees ?? 90,
        90,
      ),
    };
  }

  return base;
}

function currentNumber(
  value: MaybeAuthoredValue<number> | undefined,
  fallback: number,
) {
  return value ?? fallback;
}

function applyHoleOptionsPatch(
  options: HoleAdvancedOptions,
  patch: Record<string, unknown>,
): HoleAdvancedOptions {
  const style = acceptAuthoredPatch(
    patch.style,
    options.style ?? "simple",
    (value): value is HoleStyle =>
      value === "simple" || value === "counterbore" || value === "countersink",
  );
  const literalStyle = authoredStringLiteral(style, "simple");
  const termination = acceptAuthoredPatch(
    patch.termination,
    options.termination ?? "blind",
    (value): value is HoleTermination => value === "blind" || value === "throughAll",
  );
  const base = {
    mainDiameter: acceptAuthoredPatch(
      patch.mainDiameter,
      options.mainDiameter ?? 1,
      (value): value is number => typeof value === "number",
    ),
    termination,
    direction: acceptAuthoredPatch(
      patch.direction,
      options.direction ?? "forward",
      (value): value is HoleDirection => value === "forward" || value === "reverse",
    ),
    depth: acceptAuthoredPatch(
      patch.depth,
      options.depth ?? 5,
      (value): value is number => typeof value === "number",
    ),
  };

  if (literalStyle === "counterbore") {
    return {
      ...base,
      style: literalStyle,
      counterboreDiameter: acceptAuthoredPatch(
        patch.counterboreDiameter,
        currentNumber(options.counterboreDiameter, 2),
        (value): value is number => typeof value === "number",
      ),
      counterboreDepth: acceptAuthoredPatch(
        patch.counterboreDepth,
        currentNumber(options.counterboreDepth, 1),
        (value): value is number => typeof value === "number",
      ),
    };
  }

  if (literalStyle === "countersink") {
    return {
      ...base,
      style: literalStyle,
      countersinkDiameter: acceptAuthoredPatch(
        patch.countersinkDiameter,
        currentNumber(options.countersinkDiameter, 2),
        (value): value is number => typeof value === "number",
      ),
      countersinkAngleDegrees: acceptAuthoredPatch(
        patch.countersinkAngleDegrees,
        currentNumber(options.countersinkAngleDegrees, 90),
        (value): value is number => typeof value === "number",
      ),
    };
  }

  return { ...base, style: "simple" };
}

function buildHoleDefinition(draft: HoleFeatureParameterDraft) {
  return {
    kind: "hole" as const,
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        { role: "location" as const, targets: draft.locationTargets },
        { role: "body" as const, targets: draft.bodyTargets },
      ],
      options: buildHoleOptions(draft.options),
    },
  };
}

function getHoleValidationDiagnostics(draft: HoleFeatureParameterDraft) {
  return validateAdvancedSolidFeatureDefinition(buildHoleDefinition(draft), {
    featureKind: "hole",
    participants: holeParticipants,
    options: holeOptions,
  });
}

function isCountersinkAngle(value: HoleAdvancedOptions["countersinkAngleDegrees"]) {
  if (value === undefined) return false;
  const literal = authoredNumberLiteral(value);
  return literal !== null && literal > 0 && literal < 180;
}

function getInvalidOptionLabel(draft: HoleFeatureParameterDraft) {
  const { options } = draft;
  const style = holeStyle(options);
  if (!isPositiveAuthoredNumber(options.mainDiameter)) return "main diameter";
  if (holeTermination(options) === "blind" && !isPositiveAuthoredNumber(options.depth ?? 0)) {
    return "blind depth";
  }
  if (style === "counterbore") {
    if (!isPositiveAuthoredNumber(options.counterboreDiameter ?? 0)) return "counterbore diameter";
    if (!isPositiveAuthoredNumber(options.counterboreDepth ?? 0)) return "counterbore depth";
  }
  if (style === "countersink") {
    if (!isPositiveAuthoredNumber(options.countersinkDiameter ?? 0)) return "countersink diameter";
    if (!isFiniteAuthoredNumber(options.countersinkAngleDegrees ?? 0) || !isCountersinkAngle(options.countersinkAngleDegrees)) {
      return "countersink angle";
    }
  }
  return null;
}

function numericField(
  id: string,
  label: string,
  value: HoleAdvancedOptions[keyof HoleAdvancedOptions] | undefined,
  patchKey: string,
  errorMessage: string,
  input: "number" | "angleDegrees" = "number",
) {
  const fallback = value ?? 1;
  return {
    kind: "numeric" as const,
    id,
    label,
    value: authoredNumberFormValue(fallback as HoleAdvancedOptions["mainDiameter"]),
    input,
    step: input === "angleDegrees" ? 1 : 0.1,
    authoredValue: expressionCapableAuthoredValue(fallback, {
      kind: input === "angleDegrees" ? "angle" : "positiveNumber",
    }),
    error:
      input === "angleDegrees"
        ? isFiniteAuthoredNumber(fallback as HoleAdvancedOptions["mainDiameter"])
          ? null
          : { message: errorMessage }
        : isPositiveAuthoredNumber(fallback as HoleAdvancedOptions["mainDiameter"])
          ? null
          : { message: errorMessage },
    patch: { patchKey },
  };
}

export const holeAuthoringDefinition = {
  metadata: {
    kind: "hole",
    name: "Hole",
    tooltip: "Cut holes from sketch-point locations.",
    icon: "circle",
    toolId: "hole",
    groupId: "features",
    modes: ["part"],
  },
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  selectionFilter: holeSelectionFilter,
  advancedParticipants: holeParticipants,
  createDraft(input) {
    const locationTarget = asSketchPointRef(input.selectedTarget);
    const bodyTarget = asBodyRef(input.selectedTarget);
    return {
      locationTargets: locationTarget ? [locationTarget] : [],
      bodyTargets: bodyTarget ? [bodyTarget] : [],
      options: { style: "simple", mainDiameter: 1, termination: "blind", depth: 5 },
    };
  },
  hydrateDraft(feature) {
    const locationTargets =
      feature.parameters.participants.find(
        (participant) => participant.role === "location",
      )?.targets ?? [];
    const bodyTargets =
      feature.parameters.participants.find(
        (participant) => participant.role === "body",
      )?.targets ?? [];
    return {
      locationTargets: filterTargets(locationTargets, asSketchPointRef),
      bodyTargets: filterTargets(bodyTargets, asBodyRef),
      options: normalizeHoleOptions(feature.parameters.options),
    };
  },
  applyPatch(draft, patch) {
    return {
      ...draft,
      locationTargets:
        patch.locationTargets === undefined && patch.locationTarget === undefined
          ? draft.locationTargets
          : Array.isArray(patch.locationTargets)
            ? filterTargets(patch.locationTargets, asSketchPointRef)
            : asSketchPointRef(patch.locationTarget as PrimitiveRef | null)
              ? [patch.locationTarget as (typeof draft.locationTargets)[number]]
              : draft.locationTargets,
      bodyTargets:
        patch.bodyTargets === undefined && patch.bodyTarget === undefined
          ? draft.bodyTargets
          : Array.isArray(patch.bodyTargets)
            ? filterTargets(patch.bodyTargets, asBodyRef)
            : asBodyRef(patch.bodyTarget as PrimitiveRef | null)
              ? [patch.bodyTarget as (typeof draft.bodyTargets)[number]]
              : draft.bodyTargets,
      options: applyHoleOptionsPatch(draft.options, patch),
    };
  },
  applySelection(draft, target) {
    if (target.kind === "sketchPoint") {
      return {
        ...draft,
        locationTargets: appendUniqueTarget(draft.locationTargets, target),
      };
    }
    if (target.kind === "body") {
      return {
        ...draft,
        bodyTargets: appendUniqueTarget(draft.bodyTargets, target),
      };
    }
    return draft;
  },
  getPrimarySelectionTarget(draft) {
    return draft.locationTargets[0] ?? draft.bodyTargets[0] ?? null;
  },
  getPreviewLabel(draft, prefix) {
    if (draft.locationTargets.length === 0) return "Select one or more sketch points for hole locations";
    if (draft.bodyTargets.length === 0) return "Select one or more bodies for hole targets";
    const invalid = getInvalidOptionLabel(draft);
    if (invalid) return `Enter positive hole ${invalid}`;
    return `${prefix} ${holeStyle(draft.options)} hole on ${draft.locationTargets.length} location${draft.locationTargets.length === 1 ? "" : "s"}`;
  },
  getMissingInputsDiagnostics(input) {
    const diagnostics = getHoleValidationDiagnostics(input.draft);
    if (diagnostics.length > 0) {
      return diagnostics.map((diagnostic) => ({
        code: `feature-${input.phase}-${diagnostic.code}`,
        severity: input.phase === "preview" ? ("warning" as const) : ("error" as const),
        message: diagnostic.message,
        target: diagnostic.target,
        detail: {
          kind: "advancedFeatureValidation" as const,
          diagnostic,
        },
      }));
    }

    return [
      createMissingInputDiagnostic({
        feature: "hole",
        phase: input.phase,
        suffix: "location",
        message: "Hole preview requires at least one sketch-point location and body target.",
      }),
    ];
  },
  buildDefinition(draft) {
    return getHoleValidationDiagnostics(draft).length === 0
      ? buildHoleDefinition(draft)
      : null;
  },
  getFormSchema(session) {
    const { options } = session.draft;
    const style = holeStyle(options);
    const termination = holeTermination(options);
    return {
      sections: [
        {
          id: "references",
          title: "References",
          fields: [
            {
              kind: "referenceCollection",
              id: "hole-locations",
              label: "Hole locations",
              value: session.draft.locationTargets,
              emptyLabel: "None selected",
              helper: "Sketch points define centers and inherit direction from their owning sketch planes.",
              error:
                session.draft.locationTargets.length > 0
                  ? null
                  : { message: "Select at least one sketch point." },
              advancedParticipant: {
                role: "location",
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.locationTargets.length,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  holeSelectionFilter,
                  "hole-location",
                  "Hole locations",
                ),
                itemLabel: "Sketch point",
              },
              patch: { patchKey: "locationTargets" },
            },
            {
              kind: "referenceCollection",
              id: "hole-bodies",
              label: "Body targets",
              value: session.draft.bodyTargets,
              emptyLabel: "None selected",
              helper: "Holes are implicitly subtractive against selected bodies.",
              error:
                session.draft.bodyTargets.length > 0
                  ? null
                  : { message: "Select at least one body target." },
              advancedParticipant: {
                role: "body",
                required: true,
                cardinality: { min: 1, max: null },
                selectedCount: session.draft.bodyTargets.length,
              },
              picker: {
                mode: "appendUnique",
                allowsMultiple: true,
                selectionFilter: createSelectionFilterForRequirement(
                  holeSelectionFilter,
                  "hole-body",
                  "Hole body targets",
                ),
                itemLabel: "Body",
              },
              patch: { patchKey: "bodyTargets" },
            },
          ],
        },
        {
          id: "parameters",
          title: "Parameters",
          fields: [
            {
              kind: "enum",
              id: "hole-style",
              label: "Hole style",
              value: style,
              options: [
                { value: "simple", label: "Simple" },
                { value: "counterbore", label: "Counterbore" },
                { value: "countersink", label: "Countersink" },
              ],
              patch: { patchKey: "style" },
            },
            numericField("hole-main-diameter", "Main diameter", options.mainDiameter, "mainDiameter", "Main diameter must be greater than zero."),
            ...(style === "counterbore"
              ? [
                  numericField("hole-counterbore-diameter", "Counterbore diameter", options.counterboreDiameter, "counterboreDiameter", "Counterbore diameter must be greater than zero."),
                  numericField("hole-counterbore-depth", "Counterbore depth", options.counterboreDepth, "counterboreDepth", "Counterbore depth must be greater than zero."),
                ]
              : []),
            ...(style === "countersink"
              ? [
                  numericField("hole-countersink-diameter", "Countersink diameter", options.countersinkDiameter, "countersinkDiameter", "Countersink diameter must be greater than zero."),
                  {
                    ...numericField("hole-countersink-angle", "Countersink angle", options.countersinkAngleDegrees, "countersinkAngleDegrees", "Countersink angle must be greater than 0 and less than 180 degrees.", "angleDegrees"),
                    error: isCountersinkAngle(options.countersinkAngleDegrees)
                      ? null
                      : { message: "Countersink angle must be greater than 0 and less than 180 degrees." },
                  },
                ]
              : []),
            {
              kind: "enum",
              id: "hole-termination",
              label: "Termination",
              value: termination,
              options: [
                { value: "blind", label: "Blind" },
                { value: "throughAll", label: "Through all" },
              ],
              patch: { patchKey: "termination" },
            },
            ...(termination === "blind"
              ? [
                  numericField("hole-depth", "Blind depth", options.depth, "depth", "Blind depth must be greater than zero."),
                ]
              : []),
          ],
        },
        {
          id: "diagnostics",
          title: "Diagnostics",
          fields: [
            {
              kind: "diagnostics",
              id: "hole-diagnostics",
              label: "Diagnostics",
              diagnostics: session.diagnostics,
            },
          ],
        },
      ],
    };
  },
} satisfies FeatureAuthoringDefinition<"hole">;

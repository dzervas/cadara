import type { BodyId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import {
  getAuthoredLiteralValue,
  isExpressionAuthoredValue,
  validateFeatureValueKind,
  type FeatureValueKindDescriptor,
  type MaybeAuthoredValue,
} from '@/contracts/modeling/authored-values'

export const ADVANCED_SOLID_FEATURE_SCHEMA_VERSION = 'advanced-solid-feature/v0' as const

export type AdvancedParticipantRole =
  | 'profile'
  | 'path'
  | 'guideCurve'
  | 'lockProfileFace'
  | 'lockProfileDirection'
  | 'face'
  | 'edge'
  | 'body'
  | 'toolBody'
  | 'targetBody'
  | 'plane'
  | 'axis'
  | 'transformReference'
  | 'enclosingRegionSeed'

export type AdvancedSolidOperationIntent = 'create' | 'add' | 'subtract' | 'intersect'

export type AdvancedSolidFeatureKind =
  | 'combine'
  | 'sweep'
  | 'loft'
  | 'wrap'
  | 'thicken'
  | 'enclose'
  | 'split'
  | 'deleteSolid'
  | 'faceBlend'
  | 'chamfer'
  | 'hole'
  | 'externalThread'
  | 'mirror'
  | 'transform'

export type AdvancedParticipantTargetKind = DurableRef['kind']

export interface AdvancedParticipantCardinality {
  min: number
  max: number | null
}

export interface AdvancedParticipantDescriptor {
  role: AdvancedParticipantRole
  label: string
  required: boolean
  cardinality: AdvancedParticipantCardinality
  acceptedKinds: readonly AdvancedParticipantTargetKind[]
}

export interface AdvancedOperationIntentDescriptor {
  supportedIntents: readonly AdvancedSolidOperationIntent[]
  requiredParticipantsByIntent?: Partial<Record<AdvancedSolidOperationIntent, readonly AdvancedParticipantRole[]>>
}

export type AdvancedFeatureScalarOptionValueKind =
  | 'boolean'
  | 'enum'
  | 'angle'
  | 'positiveNumber'
  | 'positiveInteger'

export interface AdvancedFeatureOptionPatchTarget {
  patchKey: string
  valuePath?: readonly (string | number)[]
}

export interface AdvancedFeatureScalarOptionDescriptor {
  key: string
  label: string
  required: boolean
  valueKind: AdvancedFeatureScalarOptionValueKind
  enumValues?: readonly string[]
  patchTarget?: AdvancedFeatureOptionPatchTarget
}

export interface AdvancedFeatureOptionGroupDescriptor {
  key: string
  label: string
  required: boolean
  valueKind: 'group'
  options: readonly AdvancedFeatureOptionDescriptor[]
  patchTarget?: AdvancedFeatureOptionPatchTarget
}

export interface AdvancedFeatureDiscriminatedOptionVariant {
  value: string
  label: string
  options: readonly AdvancedFeatureOptionDescriptor[]
}

export interface AdvancedFeatureDiscriminatedOptionGroupDescriptor {
  key: string
  label: string
  required: boolean
  valueKind: 'discriminatedGroup'
  discriminantKey: string
  variants: readonly AdvancedFeatureDiscriminatedOptionVariant[]
  patchTarget?: AdvancedFeatureOptionPatchTarget
}

export type AdvancedFeatureOptionDescriptor =
  | AdvancedFeatureScalarOptionDescriptor
  | AdvancedFeatureOptionGroupDescriptor
  | AdvancedFeatureDiscriminatedOptionGroupDescriptor

export interface AdvancedParticipantValue {
  role: AdvancedParticipantRole
  targets: readonly DurableRef[]
}

export interface AdvancedSolidFeatureParameters {
  participants: readonly AdvancedParticipantValue[]
  operationIntent?: AdvancedSolidOperationIntent
  options?: Record<string, unknown>
}

export interface AdvancedSolidFeatureDefinition {
  kind: AdvancedSolidFeatureKind
  featureTypeVersion: typeof ADVANCED_SOLID_FEATURE_SCHEMA_VERSION
  parameters: AdvancedSolidFeatureParameters
}

export interface AdvancedSolidFeatureAuthoringDescriptor {
  featureKind: AdvancedSolidFeatureKind
  participants: readonly AdvancedParticipantDescriptor[]
  operationIntent?: AdvancedOperationIntentDescriptor
  options?: readonly AdvancedFeatureOptionDescriptor[]
}

export interface AdvancedFeatureValidationDiagnostic {
  code:
    | 'advanced-feature-missing-participant'
    | 'advanced-feature-invalid-cardinality'
    | 'advanced-feature-invalid-target-kind'
    | 'advanced-feature-invalid-option'
    | 'advanced-feature-unsupported-operation'
    | 'advanced-feature-unsupported-kernel-case'
  severity: 'error'
  message: string
  role: AdvancedParticipantRole | null
  target: DurableRef | null
}

export type LoftGuideContinuity =
  | 'none'
  | 'normalToGuide'
  | 'tangentToGuide'
  | 'matchTangent'
  | 'matchCurvature'

export type LoftProfileConditionKind = 'none' | 'normal' | 'tangent'

export interface LoftProfileConditionOptions {
  condition: MaybeAuthoredValue<LoftProfileConditionKind>
  magnitude?: MaybeAuthoredValue<number>
}

export interface LoftPathOptions {
  sectionCount: MaybeAuthoredValue<number>
}

export interface LoftMatchConnection {
  from: DurableRef
  to: DurableRef
}

export interface LoftAdvancedOptions extends Record<string, unknown> {
  path?: LoftPathOptions
  guideContinuity?: MaybeAuthoredValue<LoftGuideContinuity>
  profileConditions?: {
    startCondition: MaybeAuthoredValue<LoftProfileConditionKind>
    startMagnitude?: MaybeAuthoredValue<number>
    endCondition: MaybeAuthoredValue<LoftProfileConditionKind>
    endMagnitude?: MaybeAuthoredValue<number>
  }
  matchConnections?: readonly LoftMatchConnection[]
}

const advancedSolidFeatureKinds: readonly AdvancedSolidFeatureKind[] = [
  'combine',
  'sweep',
  'loft',
  'wrap',
  'thicken',
  'enclose',
  'split',
  'deleteSolid',
  'faceBlend',
  'chamfer',
  'hole',
  'externalThread',
  'mirror',
  'transform',
]

const advancedParticipantRoles: readonly AdvancedParticipantRole[] = [
  'profile',
  'path',
  'guideCurve',
  'lockProfileFace',
  'lockProfileDirection',
  'face',
  'edge',
  'body',
  'toolBody',
  'targetBody',
  'plane',
  'axis',
  'transformReference',
  'enclosingRegionSeed',
]

export const LOFT_ADVANCED_OPTION_DESCRIPTORS = [
  {
    key: 'path',
    label: 'Path options',
    required: false,
    valueKind: 'group',
    options: [
      {
        key: 'sectionCount',
        label: 'Section count',
        required: true,
        valueKind: 'positiveInteger',
        patchTarget: { patchKey: 'options', valuePath: ['path', 'sectionCount'] },
      },
    ],
  },
  {
    key: 'guideContinuity',
    label: 'Guide continuity',
    required: false,
    valueKind: 'enum',
    enumValues: ['none', 'normalToGuide', 'tangentToGuide', 'matchTangent', 'matchCurvature'],
    patchTarget: { patchKey: 'options', valuePath: ['guideContinuity'] },
  },
  {
    key: 'profileConditions',
    label: 'Profile conditions',
    required: false,
    valueKind: 'group',
    options: [
      {
        key: 'startCondition',
        label: 'Start condition',
        required: true,
        valueKind: 'enum',
        enumValues: ['none', 'normal', 'tangent'],
        patchTarget: { patchKey: 'options', valuePath: ['profileConditions', 'startCondition'] },
      },
      {
        key: 'startMagnitude',
        label: 'Start magnitude',
        required: false,
        valueKind: 'positiveNumber',
        patchTarget: { patchKey: 'options', valuePath: ['profileConditions', 'startMagnitude'] },
      },
      {
        key: 'endCondition',
        label: 'End condition',
        required: true,
        valueKind: 'enum',
        enumValues: ['none', 'normal', 'tangent'],
        patchTarget: { patchKey: 'options', valuePath: ['profileConditions', 'endCondition'] },
      },
      {
        key: 'endMagnitude',
        label: 'End magnitude',
        required: false,
        valueKind: 'positiveNumber',
        patchTarget: { patchKey: 'options', valuePath: ['profileConditions', 'endMagnitude'] },
      },
    ],
  },
] as const satisfies readonly AdvancedFeatureOptionDescriptor[]

export type SweepProfileControl =
  | 'none'
  | 'keepProfileOrientation'
  | 'lockProfileFaces'
  | 'lockProfileDirection'

export type SweepTwistOption =
  | { type: 'none' }
  | { type: 'turns'; turns: MaybeAuthoredValue<number> }
  | { type: 'angle'; angle: MaybeAuthoredValue<number> }
  | { type: 'pitch'; pitch: MaybeAuthoredValue<number> }

export interface SweepAdvancedOptions extends Record<string, unknown> {
  profileControl: MaybeAuthoredValue<SweepProfileControl>
  twist: SweepTwistOption
  endScale: MaybeAuthoredValue<number>
}

export const SWEEP_ADVANCED_OPTION_DESCRIPTORS = [
  {
    key: 'profileControl',
    label: 'Profile control',
    required: false,
    valueKind: 'enum',
    enumValues: ['none', 'keepProfileOrientation', 'lockProfileFaces', 'lockProfileDirection'],
    patchTarget: { patchKey: 'options', valuePath: ['profileControl'] },
  },
  {
    key: 'twist',
    label: 'Twist',
    required: false,
    valueKind: 'group',
    options: [
      {
        key: 'twist',
        label: 'Twist type',
        required: true,
        valueKind: 'discriminatedGroup',
        discriminantKey: 'type',
        patchTarget: { patchKey: 'options', valuePath: ['twist', 'type'] },
        variants: [
          { value: 'none', label: 'None', options: [] },
          {
            value: 'turns',
            label: 'Turns',
            options: [
              {
                key: 'turns',
                label: 'Turns',
                required: true,
                valueKind: 'positiveNumber',
                patchTarget: { patchKey: 'options', valuePath: ['twist', 'turns'] },
              },
            ],
          },
          {
            value: 'angle',
            label: 'Angle',
            options: [
              {
                key: 'angle',
                label: 'Angle',
                required: true,
                valueKind: 'angle',
                patchTarget: { patchKey: 'options', valuePath: ['twist', 'angle'] },
              },
            ],
          },
          {
            value: 'pitch',
            label: 'Pitch',
            options: [
              {
                key: 'pitch',
                label: 'Pitch',
                required: true,
                valueKind: 'positiveNumber',
                patchTarget: { patchKey: 'options', valuePath: ['twist', 'pitch'] },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'endScale',
    label: 'End scale',
    required: false,
    valueKind: 'positiveNumber',
    patchTarget: { patchKey: 'options', valuePath: ['endScale'] },
  },
] as const satisfies readonly AdvancedFeatureOptionDescriptor[]

export function isAdvancedSolidFeatureKind(value: unknown): value is AdvancedSolidFeatureKind {
  return typeof value === 'string' && advancedSolidFeatureKinds.includes(value as AdvancedSolidFeatureKind)
}

export function isAdvancedParticipantRole(value: unknown): value is AdvancedParticipantRole {
  return typeof value === 'string' && advancedParticipantRoles.includes(value as AdvancedParticipantRole)
}

export function getAdvancedParticipant(
  definition: AdvancedSolidFeatureDefinition,
  role: AdvancedParticipantRole,
) {
  return definition.parameters.participants.find((participant) => participant.role === role) ?? null
}

function createAdvancedDiagnostic(input: {
  code: AdvancedFeatureValidationDiagnostic['code']
  message: string
  role: AdvancedParticipantRole | null
  target?: DurableRef | null
}): AdvancedFeatureValidationDiagnostic {
  return {
    code: input.code,
    severity: 'error',
    message: input.message,
    role: input.role,
    target: input.target ?? null,
  }
}

export function validateAdvancedSolidFeatureDefinition(
  definition: AdvancedSolidFeatureDefinition,
  descriptor: AdvancedSolidFeatureAuthoringDescriptor,
): AdvancedFeatureValidationDiagnostic[] {
  const diagnostics: AdvancedFeatureValidationDiagnostic[] = []
  const participantsByRole = new Map<AdvancedParticipantRole, readonly DurableRef[]>()

  for (const participant of definition.parameters.participants) {
    participantsByRole.set(participant.role, participant.targets)
  }

  const operationIntent = definition.parameters.operationIntent
    ? getAuthoredLiteralValue(definition.parameters.operationIntent)
    : undefined
  if (operationIntent && !descriptor.operationIntent?.supportedIntents.includes(operationIntent)) {
    diagnostics.push(createAdvancedDiagnostic({
      code: 'advanced-feature-unsupported-operation',
      role: null,
      message: `${definition.kind} does not support ${operationIntent} operation intent.`,
    }))
  }

  const operationRequiredRoles = operationIntent
    ? descriptor.operationIntent?.requiredParticipantsByIntent?.[operationIntent] ?? []
    : []

  for (const participantDescriptor of descriptor.participants) {
    const targets = participantsByRole.get(participantDescriptor.role) ?? []
    const min = operationRequiredRoles.includes(participantDescriptor.role)
      ? Math.max(1, participantDescriptor.cardinality.min)
      : participantDescriptor.cardinality.min
    const max = participantDescriptor.cardinality.max

    if ((participantDescriptor.required || min > 0) && targets.length < min) {
      diagnostics.push(createAdvancedDiagnostic({
        code: 'advanced-feature-missing-participant',
        role: participantDescriptor.role,
        message: `${participantDescriptor.label} requires at least ${min} selected target${min === 1 ? '' : 's'}.`,
      }))
    }

    if (targets.length < min || (max !== null && targets.length > max)) {
      diagnostics.push(createAdvancedDiagnostic({
        code: 'advanced-feature-invalid-cardinality',
        role: participantDescriptor.role,
        message: `${participantDescriptor.label} has ${targets.length} target${targets.length === 1 ? '' : 's'}; expected ${min}${max === null ? '+' : `-${max}`}.`,
      }))
    }

    for (const target of targets) {
      if (!participantDescriptor.acceptedKinds.includes(target.kind)) {
        diagnostics.push(createAdvancedDiagnostic({
          code: 'advanced-feature-invalid-target-kind',
          role: participantDescriptor.role,
          target,
          message: `${participantDescriptor.label} does not accept ${target.kind} targets.`,
        }))
      }
    }
  }

  diagnostics.push(...validateAdvancedFeatureOptions(definition.parameters.options ?? {}, descriptor.options ?? []))
  if (definition.kind === 'loft') {
    diagnostics.push(...validateLoftAdvancedOptions(definition as AdvancedSolidFeatureDefinition & { kind: 'loft' }))
  }

  return diagnostics
}

function validateLoftAdvancedOptions(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  const diagnostics: AdvancedFeatureValidationDiagnostic[] = []
  const options = definition.parameters.options ?? {}
  const guideTargets = getAdvancedParticipant(definition, 'guideCurve')?.targets ?? []
  const guideContinuity = getAuthoredLiteralValue(options.guideContinuity as MaybeAuthoredValue<unknown>)

  if (guideContinuity !== undefined && guideContinuity !== 'none' && guideTargets.length === 0) {
    diagnostics.push(createInvalidOptionDiagnostic('Guide continuity requires at least one guide curve participant.'))
  }

  const connections = options.matchConnections
  if (connections === undefined) {
    return diagnostics
  }

  if (!Array.isArray(connections)) {
    return [...diagnostics, createInvalidOptionDiagnostic('Match connections must be a connection list.')]
  }

  for (const connection of connections) {
    if (!isRecord(connection)) {
      diagnostics.push(createInvalidOptionDiagnostic('Match connection entries must be option groups.'))
      continue
    }

    const from = connection.from
    const to = connection.to
    if (!isLoftConnectionEndpoint(from) || !isLoftConnectionEndpoint(to)) {
      diagnostics.push(createInvalidOptionDiagnostic('Match connections require one durable edge or vertex selection on each profile side.'))
    }
  }

  return diagnostics
}

function isLoftConnectionEndpoint(value: unknown): value is DurableRef {
  return isRecord(value)
    && (
      (value.kind === 'edge' && typeof value.bodyId === 'string' && typeof value.edgeId === 'string') ||
      (value.kind === 'vertex' && typeof value.bodyId === 'string' && typeof value.vertexId === 'string')
    )
}

export function validateAdvancedFeatureOptions(
  options: Record<string, unknown>,
  descriptors: readonly AdvancedFeatureOptionDescriptor[],
): AdvancedFeatureValidationDiagnostic[] {
  const diagnostics: AdvancedFeatureValidationDiagnostic[] = []

  for (const descriptor of descriptors) {
    diagnostics.push(...validateAdvancedFeatureOption(options, descriptor))
  }

  return diagnostics
}

function validateAdvancedFeatureOption(
  options: Record<string, unknown>,
  descriptor: AdvancedFeatureOptionDescriptor,
): AdvancedFeatureValidationDiagnostic[] {
  switch (descriptor.valueKind) {
    case 'group':
      return validateAdvancedFeatureOptionGroup(options, descriptor)
    case 'discriminatedGroup':
      return validateAdvancedFeatureDiscriminatedOptionGroup(options, descriptor)
    default:
      return validateAdvancedFeatureScalarOption(options, descriptor)
  }
}

function validateAdvancedFeatureScalarOption(
  options: Record<string, unknown>,
  descriptor: AdvancedFeatureScalarOptionDescriptor,
): AdvancedFeatureValidationDiagnostic[] {
  const optionValue = options[descriptor.key]
  const value = optionValue === undefined
    ? undefined
    : getAuthoredLiteralValue(optionValue as MaybeAuthoredValue<unknown>)

  if (descriptor.required && value === undefined) {
    return [createInvalidOptionDiagnostic(`${descriptor.label} is required.`)]
  }

  if (optionValue !== undefined && isExpressionAuthoredValue(optionValue)) {
    return []
  }

  if (value === undefined) {
    return []
  }

  const valueKind = getFeatureValueKindDescriptor(descriptor)
  const validation = validateFeatureValueKind(value, valueKind)
  return validation.ok
    ? []
    : [createInvalidOptionDiagnostic(`${descriptor.label}: ${validation.failure.message}`)]
}

function validateAdvancedFeatureOptionGroup(
  options: Record<string, unknown>,
  descriptor: AdvancedFeatureOptionGroupDescriptor,
): AdvancedFeatureValidationDiagnostic[] {
  const groupValue = options[descriptor.key]

  if (descriptor.required && groupValue === undefined) {
    return [createInvalidOptionDiagnostic(`${descriptor.label} is required.`)]
  }

  if (groupValue === undefined) {
    return []
  }

  if (!isRecord(groupValue)) {
    return [createInvalidOptionDiagnostic(`${descriptor.label} must be an option group.`)]
  }

  return validateAdvancedFeatureOptions(groupValue, descriptor.options)
}

function validateAdvancedFeatureDiscriminatedOptionGroup(
  options: Record<string, unknown>,
  descriptor: AdvancedFeatureDiscriminatedOptionGroupDescriptor,
): AdvancedFeatureValidationDiagnostic[] {
  const rawDiscriminantValue = options[descriptor.discriminantKey]
  const discriminantValue = getAuthoredLiteralValue(rawDiscriminantValue as MaybeAuthoredValue<unknown>)

  if (descriptor.required && discriminantValue === undefined) {
    return [createInvalidOptionDiagnostic(`${descriptor.label} is required.`)]
  }

  if (rawDiscriminantValue !== undefined && isExpressionAuthoredValue(rawDiscriminantValue)) {
    return []
  }

  if (discriminantValue === undefined) {
    return []
  }

  if (typeof discriminantValue !== 'string') {
    return [createInvalidOptionDiagnostic(`${descriptor.label} must select a variant.`)]
  }

  const activeVariant = descriptor.variants.find((variant) => variant.value === discriminantValue)
  if (!activeVariant) {
    return [createInvalidOptionDiagnostic(`${descriptor.label} must be one of: ${descriptor.variants.map((variant) => variant.value).join(', ')}.`)]
  }

  const inactiveKeys = new Set(
    descriptor.variants
      .filter((variant) => variant.value !== activeVariant.value)
      .flatMap((variant) => collectAdvancedFeatureOptionKeys(variant.options)),
  )
  const diagnostics: AdvancedFeatureValidationDiagnostic[] = []

  for (const inactiveKey of inactiveKeys) {
    if (options[inactiveKey] !== undefined) {
      diagnostics.push(createInvalidOptionDiagnostic(`${descriptor.label} has inactive ${inactiveKey} value for ${discriminantValue}.`))
    }
  }

  diagnostics.push(...validateAdvancedFeatureOptions(options, activeVariant.options))
  return diagnostics
}

function collectAdvancedFeatureOptionKeys(descriptors: readonly AdvancedFeatureOptionDescriptor[]): string[] {
  return descriptors.flatMap((descriptor) => {
    if (descriptor.valueKind === 'group') {
      return [descriptor.key, ...collectAdvancedFeatureOptionKeys(descriptor.options)]
    }

    if (descriptor.valueKind === 'discriminatedGroup') {
      return [
        descriptor.discriminantKey,
        ...descriptor.variants.flatMap((variant) => collectAdvancedFeatureOptionKeys(variant.options)),
      ]
    }

    return [descriptor.key]
  })
}

export function getFeatureValueKindDescriptor(
  descriptor: AdvancedFeatureScalarOptionDescriptor,
): FeatureValueKindDescriptor {
  switch (descriptor.valueKind) {
    case 'boolean':
      return { kind: 'boolean' }
    case 'enum':
      return { kind: 'enumString', options: descriptor.enumValues ?? [] }
    case 'angle':
      return { kind: 'angle' }
    case 'positiveNumber':
      return { kind: 'positiveNumber' }
    case 'positiveInteger':
      return { kind: 'positiveInteger' }
  }
}

function createInvalidOptionDiagnostic(message: string) {
  return createAdvancedDiagnostic({
    code: 'advanced-feature-invalid-option',
    role: null,
    message,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const sweepAdvancedFeatureExample = {
  kind: 'sweep',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    operationIntent: 'create',
    participants: [
      { role: 'profile', targets: [{ kind: 'region', sketchId: 'sketch_profile', regionId: 'region_profile' }] },
      { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_path', edgeId: 'edge_path' }] },
    ],
  },
} satisfies AdvancedSolidFeatureDefinition

export const loftAdvancedFeatureExample = {
  kind: 'loft',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    operationIntent: 'create',
    participants: [
      {
        role: 'profile',
        targets: [
          { kind: 'region', sketchId: 'sketch_loft_a', regionId: 'region_loft_a' },
          { kind: 'face', bodyId: 'body_loft_b', faceId: 'face_loft_b' },
        ],
      },
      { role: 'path', targets: [{ kind: 'edge', bodyId: 'body_path', edgeId: 'edge_path' }] },
      { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: 'body_guide', edgeId: 'edge_guide' }] },
    ],
    options: {
      path: { sectionCount: 5 },
      guideContinuity: 'normalToGuide',
      profileConditions: {
        startCondition: 'normal',
        startMagnitude: 1,
        endCondition: 'tangent',
        endMagnitude: 1,
      },
      matchConnections: [
        {
          from: { kind: 'edge', bodyId: 'body_loft_a', edgeId: 'edge_loft_a' },
          to: { kind: 'vertex', bodyId: 'body_loft_b', vertexId: 'vertex_loft_b' },
        },
      ],
    },
  },
} satisfies AdvancedSolidFeatureDefinition

export const chamferAdvancedFeatureExample = {
  kind: 'chamfer',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    participants: [
      { role: 'edge', targets: [{ kind: 'edge', bodyId: 'body_part', edgeId: 'edge_outer' }] },
    ],
    options: { distance: 1 },
  },
} satisfies AdvancedSolidFeatureDefinition

export const thickenAdvancedFeatureExample = {
  kind: 'thicken',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    operationIntent: 'create',
    participants: [
      {
        role: 'face',
        targets: [{ kind: 'face', bodyId: 'body_sheet', faceId: 'face_sheet' }],
      },
    ],
    options: { thickness: 1.5, side: 'oneSide' },
  },
} satisfies AdvancedSolidFeatureDefinition

export const splitAdvancedFeatureExample = {
  kind: 'split',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    participants: [
      { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_target' as BodyId }] },
      { role: 'toolBody', targets: [{ kind: 'body', bodyId: 'body_tool' as BodyId }] },
    ],
  },
} satisfies AdvancedSolidFeatureDefinition

export const combineAdvancedFeatureExample = {
  kind: 'combine',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    operationIntent: 'subtract',
    participants: [
      { role: 'targetBody', targets: [{ kind: 'body', bodyId: 'body_target' as BodyId }] },
      { role: 'toolBody', targets: [{ kind: 'body', bodyId: 'body_tool' as BodyId }] },
    ],
  },
} satisfies AdvancedSolidFeatureDefinition

export const deleteSolidAdvancedFeatureExample = {
  kind: 'deleteSolid',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    participants: [
      { role: 'body', targets: [{ kind: 'body', bodyId: 'body_target' as BodyId }] },
    ],
  },
} satisfies AdvancedSolidFeatureDefinition

export const mirrorAdvancedFeatureExample = {
  kind: 'mirror',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    participants: [
      { role: 'body', targets: [{ kind: 'body', bodyId: 'body_target' as BodyId }] },
      { role: 'plane', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
    ],
    options: {
      copy: true,
    },
  },
} satisfies AdvancedSolidFeatureDefinition

export const transformAdvancedFeatureExample = {
  kind: 'transform',
  featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  parameters: {
    participants: [
      { role: 'body', targets: [{ kind: 'body', bodyId: 'body_target' as BodyId }] },
      { role: 'transformReference', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
    ],
    options: {
      distance: 5,
    },
  },
} satisfies AdvancedSolidFeatureDefinition

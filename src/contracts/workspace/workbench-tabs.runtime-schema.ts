import { z } from 'zod'

import type { DocumentId } from '@/contracts/shared/ids'
import type {
  WorkbenchTab,
  WorkbenchTabStorageKind,
  WorkbenchTabsState,
} from '@/domain/workspace/workbench-tabs'

const documentIdPattern = /^doc_.+$/

const documentIdSchema = z
  .string()
  .regex(documentIdPattern, 'Document ids must be prefixed with "doc_".')
  .transform((value) => value as DocumentId)

const storageKindSchema = z.enum(['browser', 'filesystem', 'cloud']) satisfies z.ZodType<WorkbenchTabStorageKind>

const tabSchema = z.object({
  documentId: documentIdSchema,
  title: z.string().min(1).max(256),
  storageKind: storageKindSchema,
  storageDescriptor: z.string().max(512).nullable(),
}) satisfies z.ZodType<WorkbenchTab>

export const workbenchTabsPayloadSchema = z
  .object({
    version: z.literal(1),
    tabs: z.array(tabSchema).min(1).max(64),
    activeDocumentId: documentIdSchema,
  })
  .refine((value) => value.tabs.some((tab) => tab.documentId === value.activeDocumentId), {
    message: 'activeDocumentId must reference a tab present in tabs.',
    path: ['activeDocumentId'],
  })

export type WorkbenchTabsPayload = z.infer<typeof workbenchTabsPayloadSchema>

export interface WorkbenchTabsLoadResult {
  ok: true
  state: WorkbenchTabsState | null
}

export interface WorkbenchTabsLoadFailure {
  ok: false
  reasonCode: 'invalid-json' | 'invalid-shape'
  message: string
}

export function parseWorkbenchTabsPayload(input: unknown): WorkbenchTabsLoadResult | WorkbenchTabsLoadFailure {
  const parsed = workbenchTabsPayloadSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      reasonCode: 'invalid-shape',
      message: parsed.error.issues[0]?.message ?? 'Workbench tabs payload was malformed.',
    }
  }

  return {
    ok: true,
    state: { tabs: parsed.data.tabs, activeDocumentId: parsed.data.activeDocumentId },
  }
}

export function serializeWorkbenchTabsState(state: WorkbenchTabsState): WorkbenchTabsPayload {
  return {
    version: 1,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    activeDocumentId: state.activeDocumentId,
  }
}

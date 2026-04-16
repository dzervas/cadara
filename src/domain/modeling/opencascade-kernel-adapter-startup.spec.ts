import { test } from 'bun:test'

import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { OpenCascadeKernelAdapter } from '@/domain/modeling/opencascade-kernel-adapter'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
} from '@/domain/modeling/opencascade-kernel-seed'
import { MockSketchSolverAdapter } from '@/domain/solver/mock-sketch-solver-adapter'

test('src/domain/modeling/opencascade-kernel-adapter-startup.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  let openCascadeLoadCount = 0
  const adapter = new OpenCascadeKernelAdapter({
    solverAdapter: new MockSketchSolverAdapter(),
    getOpenCascadeInstance: async () => {
      openCascadeLoadCount += 1
      throw new Error('Initial empty snapshot should not initialize OpenCascade.')
    },
  })

  const response = await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: OCC_KERNEL_DOCUMENT_ID,
  })

  assert(openCascadeLoadCount === 0, 'Initial empty snapshots should not load the OpenCascade runtime.')
  assert(response.snapshot.revisionId === OCC_KERNEL_INITIAL_REVISION_ID, 'Initial snapshot should use the OCC initial revision.')
  assert(response.snapshot.constructions.length === 3, 'Initial snapshot should include the three standard construction planes.')
  assert(response.snapshot.render.records.length > 0, 'Initial snapshot should include construction plane render records.')
})
